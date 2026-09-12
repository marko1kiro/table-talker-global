-- R11: forward hardening for manager bearer lifecycle identity and parent/cascade
-- concurrency.  This migration intentionally supersedes the R10 implementations
-- rather than rewriting an already-applied migration.
--
-- Lock order for every manager-handoff RPC which finds a live row is:
--   1. restaurant FK parent row (FOR KEY SHARE),
--   2. manager-account FK parent row (FOR KEY SHARE),
--   3. manager account advisory lock (seed 916),
--   4. bearer-hash advisory lock (seed 917),
--   5. reservation FK parent row (FOR KEY SHARE / FOR UPDATE for confirm),
--   6. pending child row (FOR UPDATE / FOR KEY SHARE).
--
-- An RPC discovers ids without making a decision, then re-reads after this
-- order.  Account-wide/retention work handles one manager at a time and hashes
-- in lexical order.  A direct FK parent DELETE necessarily owns its parent row
-- before PostgreSQL begins its cascade, so its child trigger deliberately takes
-- no advisory lock; it records terminal evidence only.  RPCs hold the parents
-- before the child, so there is no parent/child inversion with that cascade.
-- Raw bearers are accepted only as RPC arguments; this migration stores hashes.

create table if not exists public.manager_bearer_lifecycle_hashes (
  token_hash text primary key,
  first_issued_at timestamptz not null default clock_timestamp()
);
alter table public.manager_bearer_lifecycle_hashes enable row level security;
revoke all on public.manager_bearer_lifecycle_hashes from public, anon, authenticated;

-- Backfill the permanent, minimal anti-reuse register before replacing minting.
-- It intentionally has no destructive retention: deleting richer tombstones
-- must never make a previously issued manager hash mintable again.
insert into public.manager_bearer_lifecycle_hashes(token_hash)
select token_hash from public.manager_sessions
union
select token_hash from public.manager_pending_sessions
union
select token_hash from public.revoked_session_tombstones
where namespace in ('manager', 'manager_pending')
on conflict (token_hash) do nothing;

-- Parent cascades of active manager rows need the same durable verdict evidence
-- as pending cascades.  This trigger must not take advisory locks (see header).
create or replace function public.tombstone_manager_active_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.manager_bearer_lifecycle_hashes(token_hash)
  values (old.token_hash) on conflict (token_hash) do nothing;
  insert into public.revoked_session_tombstones(namespace, token_hash)
  values ('manager', old.token_hash) on conflict (namespace, token_hash) do nothing;
  return old;
end;
$$;
drop trigger if exists manager_active_terminal_tombstone on public.manager_sessions;
create trigger manager_active_terminal_tombstone
before delete on public.manager_sessions
for each row execute function public.tombstone_manager_active_delete();
revoke all on function public.tombstone_manager_active_delete()
  from public, anon, authenticated, service_role;

-- Preserve the pending trigger's no-advisory cascade rule and also make the
-- anti-reuse register robust to historical/direct privileged deletes.
create or replace function public.tombstone_unconfirmed_manager_pending_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.confirmed_at is null then
    insert into public.manager_bearer_lifecycle_hashes(token_hash)
    values (old.token_hash) on conflict (token_hash) do nothing;
    insert into public.revoked_session_tombstones(namespace, token_hash, pending_reservation_id)
    values ('manager_pending', old.token_hash, old.reservation_id)
    on conflict (namespace, token_hash) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.tombstone_unconfirmed_manager_pending_delete()
  from public, anon, authenticated, service_role;

-- The permanent register is the anti-reuse proof.  The old destructive helper
-- is retained only for API compatibility and now fails closed by never deleting
-- even richer reconciliation evidence.
create or replace function public.cleanup_manager_pending_tombstones(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_before is null or p_before > clock_timestamp() - interval '48 hours' then
    raise exception 'TOMBSTONE_CUTOFF_TOO_RECENT' using errcode = '22023';
  end if;
  return 0;
end;
$$;
revoke all on function public.cleanup_manager_pending_tombstones(timestamptz)
  from public, anon, authenticated;
grant execute on function public.cleanup_manager_pending_tombstones(timestamptz) to service_role;

create or replace function public.create_manager_session_pending(
  p_manager_id uuid, p_reservation_id uuid, p_token text
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_hash text; v_restaurant_id uuid; v_account public.manager_accounts%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  v_pending public.manager_pending_sessions%rowtype;
begin
  if p_reservation_id is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then return false; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  -- Unlocked discovery only identifies canonical parent locks; re-read below.
  select restaurant_id into v_restaurant_id from public.manager_accounts where id = p_manager_id;
  if v_restaurant_id is null then return false; end if;
  perform 1 from public.restaurants where id = v_restaurant_id for key share;
  select * into v_account from public.manager_accounts where id = p_manager_id for key share;
  if v_account.id is null or v_account.status <> 'aktif' then return false; end if;
  perform public.lock_manager_session_lifecycle(p_manager_id);
  perform public.lock_session_lifecycle_hash(v_hash);
  select * into v_reservation from public.owner_login_rate_limit_reservations
  where id = p_reservation_id for update;
  if v_reservation.id is null or v_reservation.consumed_at is not null
     or v_reservation.expires_at <= clock_timestamp() then return false; end if;
  select * into v_pending from public.manager_pending_sessions
  where reservation_id = p_reservation_id for update;
  if v_pending.id is not null then
    return v_pending.manager_id = p_manager_id and v_pending.token_hash = v_hash
      and v_pending.confirmed_at is null and v_pending.expires_at > clock_timestamp()
      and not exists (select 1 from public.manager_sessions where token_hash = v_hash);
  end if;
  -- One hash is one global manager lifecycle, irrespective of reservation.
  if exists (select 1 from public.manager_bearer_lifecycle_hashes where token_hash = v_hash)
     or exists (select 1 from public.manager_sessions where token_hash = v_hash)
     or exists (select 1 from public.manager_pending_sessions where token_hash = v_hash)
     or exists (select 1 from public.revoked_session_tombstones
                where token_hash = v_hash and namespace in ('manager', 'manager_pending')) then
    return false;
  end if;
  insert into public.manager_bearer_lifecycle_hashes(token_hash) values (v_hash);
  insert into public.manager_pending_sessions(manager_id, restaurant_id, token_hash, reservation_id, expires_at)
  values (v_account.id, v_account.restaurant_id, v_hash, p_reservation_id,
          clock_timestamp() + interval '60 seconds');
  return true;
end;
$$;
revoke all on function public.create_manager_session_pending(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid, uuid, text) to service_role;

create or replace function public.confirm_manager_session(p_token text, p_reservation_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_hash text; v_manager_id uuid; v_restaurant_id uuid;
  v_pending public.manager_pending_sessions%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then return false; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select manager_id, restaurant_id into v_manager_id, v_restaurant_id
  from public.manager_pending_sessions where token_hash = v_hash and reservation_id = p_reservation_id;
  if v_manager_id is null then
    perform public.lock_session_lifecycle_hash(v_hash);
    return false;
  end if;
  perform 1 from public.restaurants where id = v_restaurant_id for key share;
  perform 1 from public.manager_accounts where id = v_manager_id for key share;
  perform public.lock_manager_session_lifecycle(v_manager_id);
  perform public.lock_session_lifecycle_hash(v_hash);
  select * into v_reservation from public.owner_login_rate_limit_reservations
  where id = p_reservation_id for update;
  select * into v_pending from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id for update;
  if v_pending.id is null then return false; end if;
  if v_pending.confirmed_at is not null then
    return v_reservation.id is not null and v_reservation.outcome = 'succeeded'
      and v_reservation.consumed_at is not null and exists (
        select 1 from public.manager_sessions where manager_id = v_pending.manager_id
          and token_hash = v_hash and expires_at > clock_timestamp());
  end if;
  if v_reservation.id is null or v_pending.expires_at <= clock_timestamp()
     or v_reservation.consumed_at is not null or v_reservation.expires_at <= clock_timestamp() then return false; end if;
  perform public.revoke_manager_active_sessions(v_pending.manager_id, null);
  insert into public.manager_sessions(manager_id, restaurant_id, token_hash, expires_at)
  values (v_pending.manager_id, v_pending.restaurant_id, v_hash, clock_timestamp() + interval '12 hours');
  if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
    raise exception 'RESERVATION_NOT_CONSUMABLE' using errcode = 'R0001';
  end if;
  update public.manager_pending_sessions set confirmed_at = clock_timestamp()
  where id = v_pending.id and confirmed_at is null;
  if not found then raise exception 'CONFIRM_STATE_CHANGED' using errcode = 'R0003'; end if;
  return true;
end;
$$;
revoke all on function public.confirm_manager_session(text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text, uuid) to service_role;

create or replace function public.cleanup_pending_manager_session(p_token text, p_reservation_id uuid)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_hash text; v_manager_id uuid; v_restaurant_id uuid; v_reservation uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then return false; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select manager_id, restaurant_id, reservation_id into v_manager_id, v_restaurant_id, v_reservation
  from public.manager_pending_sessions where token_hash = v_hash and reservation_id = p_reservation_id and confirmed_at is null;
  if v_manager_id is null then
    perform public.lock_session_lifecycle_hash(v_hash);
    return exists (select 1 from public.revoked_session_tombstones where namespace = 'manager_pending'
      and token_hash = v_hash and pending_reservation_id = p_reservation_id);
  end if;
  perform 1 from public.restaurants where id = v_restaurant_id for key share;
  perform 1 from public.manager_accounts where id = v_manager_id for key share;
  perform public.lock_manager_session_lifecycle(v_manager_id);
  perform public.lock_session_lifecycle_hash(v_hash);
  perform 1 from public.owner_login_rate_limit_reservations where id = v_reservation for key share;
  delete from public.manager_pending_sessions where token_hash = v_hash
    and reservation_id = p_reservation_id and confirmed_at is null;
  if found then return true; end if;
  return exists (select 1 from public.revoked_session_tombstones where namespace = 'manager_pending'
    and token_hash = v_hash and pending_reservation_id = p_reservation_id);
end;
$$;
revoke all on function public.cleanup_pending_manager_session(text, uuid) from public, anon, authenticated;
grant execute on function public.cleanup_pending_manager_session(text, uuid) to service_role;

create or replace function public.revoke_manager_session_by_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_hash text; v_manager_id uuid; v_restaurant_id uuid; v_reservation_id uuid;
begin
  if p_token is null or length(p_token) < 1 or length(p_token) > 200 then return jsonb_build_object('verdict','UNKNOWN_TOKEN'); end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select manager_id, restaurant_id, reservation_id into v_manager_id, v_restaurant_id, v_reservation_id
  from public.manager_pending_sessions where token_hash = v_hash and confirmed_at is null;
  if v_manager_id is null then
    select s.manager_id, s.restaurant_id, null::uuid into v_manager_id, v_restaurant_id, v_reservation_id
    from public.manager_sessions s where s.token_hash = v_hash;
  end if;
  if v_manager_id is not null then
    perform 1 from public.restaurants where id = v_restaurant_id for key share;
    perform 1 from public.manager_accounts where id = v_manager_id for key share;
    perform public.lock_manager_session_lifecycle(v_manager_id);
  end if;
  perform public.lock_session_lifecycle_hash(v_hash);
  if v_reservation_id is not null then perform 1 from public.owner_login_rate_limit_reservations where id = v_reservation_id for key share; end if;
  delete from public.manager_sessions where token_hash = v_hash;
  if found then return jsonb_build_object('verdict','REVOKED'); end if;
  delete from public.manager_pending_sessions where token_hash = v_hash and confirmed_at is null;
  if found then return jsonb_build_object('verdict','REVOKED'); end if;
  if exists (select 1 from public.revoked_session_tombstones where token_hash = v_hash
    and namespace in ('manager','manager_pending')) then return jsonb_build_object('verdict','ALREADY_INACTIVE'); end if;
  if exists (select 1 from public.staff_sessions where token_hash = v_hash)
    or exists (select 1 from public.revoked_session_tombstones where token_hash = v_hash
      and namespace in ('super_admin','area_manager')) then return jsonb_build_object('verdict','KIND_MISMATCH'); end if;
  return jsonb_build_object('verdict','UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_manager_session_by_token(text) from public, anon, authenticated;
grant execute on function public.revoke_manager_session_by_token(text) to service_role;

create or replace function public.reconcile_manager_session_handoff(p_token text, p_reservation_id uuid)
returns text
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_hash text; v_manager_id uuid; v_restaurant_id uuid;
  v_pending public.manager_pending_sessions%rowtype; v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then return 'UNKNOWN'; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select manager_id, restaurant_id into v_manager_id, v_restaurant_id from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id;
  if v_manager_id is not null then
    perform 1 from public.restaurants where id = v_restaurant_id for key share;
    perform 1 from public.manager_accounts where id = v_manager_id for key share;
    perform public.lock_manager_session_lifecycle(v_manager_id);
  end if;
  perform public.lock_session_lifecycle_hash(v_hash);
  -- Every state read below occurs only after all available canonical locks.
  select * into v_reservation from public.owner_login_rate_limit_reservations where id = p_reservation_id for key share;
  select * into v_pending from public.manager_pending_sessions where token_hash = v_hash
    and reservation_id = p_reservation_id for key share;
  if v_pending.id is null then
    if exists (select 1 from public.revoked_session_tombstones where namespace = 'manager_pending'
      and token_hash = v_hash and pending_reservation_id = p_reservation_id) then return 'FAILED'; end if;
    return 'UNKNOWN';
  end if;
  if v_reservation.id is null then return 'UNKNOWN'; end if;
  if v_pending.confirmed_at is not null then
    if v_reservation.outcome = 'succeeded' and v_reservation.consumed_at is not null and exists(
      select 1 from public.manager_sessions where manager_id = v_pending.manager_id and token_hash = v_hash
        and expires_at > clock_timestamp()) then return 'SUCCEEDED'; end if;
    return 'FAILED';
  end if;
  if v_pending.expires_at > clock_timestamp() and v_reservation.consumed_at is null
    and v_reservation.expires_at > clock_timestamp() then return 'PENDING'; end if;
  return 'FAILED';
end;
$$;
revoke all on function public.reconcile_manager_session_handoff(text, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_manager_session_handoff(text, uuid) to service_role;

-- Shared parent-lock step used by operations whose manager is already known.
-- Discovery is deliberately repeated under locks; this helper never decides
-- authorization or lifecycle state.
create or replace function public.lock_manager_handoff_parent_rows(p_manager_id uuid)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_restaurant_id uuid;
begin
  select restaurant_id into v_restaurant_id from public.manager_accounts where id = p_manager_id;
  if v_restaurant_id is null then return; end if;
  perform 1 from public.restaurants where id = v_restaurant_id for key share;
  perform 1 from public.manager_accounts where id = p_manager_id for key share;
end;
$$;
revoke all on function public.lock_manager_handoff_parent_rows(uuid) from public, anon, authenticated, service_role;

create or replace function public.revoke_manager_active_sessions(p_manager_id uuid, p_exclude_token_hash text default null)
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_hash text; v_deleted integer := 0;
begin
  perform public.lock_manager_handoff_parent_rows(p_manager_id);
  perform public.lock_manager_session_lifecycle(p_manager_id);
  for v_hash in select token_hash from public.manager_sessions where manager_id = p_manager_id
    and token_hash is distinct from p_exclude_token_hash order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.manager_sessions where manager_id = p_manager_id and token_hash = v_hash;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_active_sessions(uuid, text) from public, anon, authenticated, service_role;

create or replace function public.revoke_manager_sessions(p_manager_id uuid)
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_hash text; v_reservation_id uuid; v_deleted integer := 0;
begin
  perform public.lock_manager_handoff_parent_rows(p_manager_id);
  perform public.lock_manager_session_lifecycle(p_manager_id);
  v_deleted := public.revoke_manager_active_sessions(p_manager_id, null);
  for v_hash, v_reservation_id in select token_hash, reservation_id from public.manager_pending_sessions
    where manager_id = p_manager_id and confirmed_at is null order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    perform 1 from public.owner_login_rate_limit_reservations where id = v_reservation_id for key share;
    delete from public.manager_pending_sessions where manager_id = p_manager_id and token_hash = v_hash and confirmed_at is null;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_manager_sessions(uuid) to service_role;

create or replace function public.expire_manager_pending_session_hash(p_token_hash text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_manager_id uuid; v_reservation_id uuid; v_deleted integer;
begin
  select manager_id, reservation_id into v_manager_id, v_reservation_id from public.manager_pending_sessions
  where token_hash = p_token_hash and confirmed_at is null;
  if v_manager_id is not null then
    perform public.lock_manager_handoff_parent_rows(v_manager_id);
    perform public.lock_manager_session_lifecycle(v_manager_id);
  end if;
  perform public.lock_session_lifecycle_hash(p_token_hash);
  if v_reservation_id is not null then perform 1 from public.owner_login_rate_limit_reservations where id = v_reservation_id for key share; end if;
  delete from public.manager_pending_sessions where token_hash = p_token_hash and confirmed_at is null
    and expires_at <= clock_timestamp();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
revoke all on function public.expire_manager_pending_session_hash(text) from public, anon, authenticated, service_role;

create or replace function public.expire_manager_pending_sessions()
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_manager_id uuid; v_hash text; v_reservation_id uuid; v_deleted integer := 0; v_count integer;
begin
  select manager_id into v_manager_id from public.manager_pending_sessions
  where confirmed_at is null and expires_at <= clock_timestamp() order by manager_id limit 1;
  if v_manager_id is null then return 0; end if;
  perform public.lock_manager_handoff_parent_rows(v_manager_id);
  perform public.lock_manager_session_lifecycle(v_manager_id);
  for v_hash, v_reservation_id in select token_hash, reservation_id from public.manager_pending_sessions
    where manager_id = v_manager_id and confirmed_at is null and expires_at <= clock_timestamp() order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    perform 1 from public.owner_login_rate_limit_reservations where id = v_reservation_id for key share;
    delete from public.manager_pending_sessions where manager_id = v_manager_id and token_hash = v_hash
      and confirmed_at is null and expires_at <= clock_timestamp();
    get diagnostics v_count = row_count; v_deleted := v_deleted + v_count;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.expire_manager_pending_sessions() from public, anon, authenticated;
grant execute on function public.expire_manager_pending_sessions() to service_role;

create or replace function public.cleanup_owner_login_rate_limits()
returns jsonb
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_manager_id uuid; v_id uuid; v_hash text; v_reservation public.owner_login_rate_limit_reservations%rowtype;
  reservations_deleted integer := 0; buckets_deleted integer;
begin
  -- One manager per transaction prevents cross-account lock cycles.
  select p.manager_id into v_manager_id from public.manager_pending_sessions p
  join public.owner_login_rate_limit_reservations r on r.id = p.reservation_id
  where (r.consumed_at < clock_timestamp() - interval '1 day' or r.expires_at < clock_timestamp() - interval '1 day')
    and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = r.id)
  order by p.manager_id limit 1;
  if v_manager_id is not null then
    perform public.lock_manager_handoff_parent_rows(v_manager_id);
    perform public.lock_manager_session_lifecycle(v_manager_id);
    for v_id, v_hash in select r.id, p.token_hash from public.manager_pending_sessions p
      join public.owner_login_rate_limit_reservations r on r.id = p.reservation_id
      where p.manager_id = v_manager_id and (r.consumed_at < clock_timestamp() - interval '1 day'
        or r.expires_at < clock_timestamp() - interval '1 day')
        and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = r.id)
      order by p.token_hash, r.id
    loop
      perform public.lock_session_lifecycle_hash(v_hash);
      select * into v_reservation from public.owner_login_rate_limit_reservations where id = v_id for update;
      if v_reservation.id is not null and (v_reservation.consumed_at < clock_timestamp() - interval '1 day'
        or v_reservation.expires_at < clock_timestamp() - interval '1 day')
        and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = v_id) then
        delete from public.owner_login_rate_limit_reservations where id = v_id;
        if found then reservations_deleted := reservations_deleted + 1; end if;
      end if;
    end loop;
  end if;
  with doomed as (
    select r.id from public.owner_login_rate_limit_reservations r
    where (r.consumed_at < clock_timestamp() - interval '1 day' or r.expires_at < clock_timestamp() - interval '1 day')
      and not exists (select 1 from public.manager_pending_sessions p where p.reservation_id = r.id)
      and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = r.id)
    order by coalesce(r.consumed_at, r.expires_at), r.id limit 1000 for update skip locked
  ) delete from public.owner_login_rate_limit_reservations r using doomed d where r.id = d.id;
  get diagnostics buckets_deleted = row_count; reservations_deleted := reservations_deleted + buckets_deleted;
  with doomed as (
    select b.bucket_hash from public.owner_login_rate_limit_buckets b where b.window_started_at < clock_timestamp() - interval '1 day'
      and not exists (select 1 from public.owner_login_rate_limit_reservations r where r.client_bucket_hash = b.bucket_hash or r.ip_bucket_hash = b.bucket_hash)
    order by b.window_started_at, b.bucket_hash limit 1000 for update skip locked
  ) delete from public.owner_login_rate_limit_buckets b using doomed d where b.bucket_hash = d.bucket_hash;
  get diagnostics buckets_deleted = row_count;
  return jsonb_build_object('reservations_deleted', reservations_deleted, 'buckets_deleted', buckets_deleted);
end;
$$;
revoke all on function public.cleanup_owner_login_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_owner_login_rate_limits() to service_role;
