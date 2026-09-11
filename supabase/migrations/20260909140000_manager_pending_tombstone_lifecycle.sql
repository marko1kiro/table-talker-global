-- R9: linearizable terminal lifecycle for manager handoffs.
--
-- Every operation which knows a bearer first takes the same transaction-scoped
-- advisory lock: hashtextextended(sha256(bearer), 917).  This is the
-- lifecycle serialization point.  Bulk operations acquire known bearer locks
-- in token_hash order; they never acquire a reservation lock before a bearer
-- lock.  This order prevents a cleanup/revoke/expiry/cascade from being
-- observed between confirmation's lookup and activation.  The raw bearer is
-- accepted only as an RPC argument; this migration stores SHA-256 hashes only.
--
-- This migration is intentionally edited in place: it has not been deployed.

alter table public.revoked_session_tombstones
  add column if not exists pending_reservation_id uuid;

alter table public.revoked_session_tombstones
  drop constraint if exists revoked_session_tombstones_namespace_check;
alter table public.revoked_session_tombstones
  add constraint revoked_session_tombstones_namespace_check
  check (namespace in ('super_admin', 'area_manager', 'manager', 'manager_pending'));

-- Private shared serialization primitive.  The fixed seed is part of the
-- lock protocol and must be used by every manager/staff bearer lifecycle RPC.
create or replace function public.lock_session_lifecycle_hash(p_token_hash text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_token_hash, 917)
  );
$$;
revoke all on function public.lock_session_lifecycle_hash(text)
  from public, anon, authenticated, service_role;

-- A delete may be initiated by cleanup/revoke/expiry or by an FK cascade from
-- a reservation, manager, or restaurant.  Recording evidence in BEFORE DELETE
-- makes every unconfirmed deletion safe, including cascades which cannot call
-- an RPC first.  The same lock is re-entrant when the caller already holds it.
create or replace function public.tombstone_unconfirmed_manager_pending_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.confirmed_at is null then
    perform public.lock_session_lifecycle_hash(old.token_hash);
    insert into public.revoked_session_tombstones(
      namespace, token_hash, pending_reservation_id
    ) values (
      'manager_pending', old.token_hash, old.reservation_id
    ) on conflict (namespace, token_hash) do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists manager_pending_terminal_tombstone on public.manager_pending_sessions;
create trigger manager_pending_terminal_tombstone
before delete on public.manager_pending_sessions
for each row execute function public.tombstone_unconfirmed_manager_pending_delete();
revoke all on function public.tombstone_unconfirmed_manager_pending_delete()
  from public, anon, authenticated, service_role;

-- Expire one hash under its lifecycle lock.  Token-aware RPCs use this instead
-- of a global scan, so they cannot deadlock behind unrelated expiring tokens.
create or replace function public.expire_manager_pending_session_hash(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  perform public.lock_session_lifecycle_hash(p_token_hash);
  delete from public.manager_pending_sessions
  where token_hash = p_token_hash
    and confirmed_at is null
    and expires_at <= clock_timestamp();
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
revoke all on function public.expire_manager_pending_session_hash(text)
  from public, anon, authenticated, service_role;

-- Standalone TTL retention locks each bearer in deterministic hash order and
-- rechecks eligibility after each lock.  Its DELETE invokes the trigger above.
create or replace function public.expire_manager_pending_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_deleted integer := 0;
  v_count integer;
begin
  for v_hash in
    select token_hash
    from public.manager_pending_sessions
    where confirmed_at is null and expires_at <= clock_timestamp()
    order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.manager_pending_sessions
    where token_hash = v_hash
      and confirmed_at is null
      and expires_at <= clock_timestamp();
    get diagnostics v_count = row_count;
    v_deleted := v_deleted + v_count;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.expire_manager_pending_sessions()
  from public, anon, authenticated;
grant execute on function public.expire_manager_pending_sessions() to service_role;

-- Revoke active rows one hash at a time.  The ordered loop is also used by
-- account-wide revocation, while confirmation uses it to tombstone sessions it
-- supersedes.  No raw bearer is returned or recorded.
create or replace function public.revoke_manager_active_sessions(
  p_manager_id uuid,
  p_exclude_token_hash text default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_deleted integer := 0;
begin
  for v_hash in
    select token_hash
    from public.manager_sessions
    where manager_id = p_manager_id
      and token_hash is distinct from p_exclude_token_hash
    order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.manager_sessions
    where manager_id = p_manager_id and token_hash = v_hash;
    if found then
      v_deleted := v_deleted + 1;
      insert into public.revoked_session_tombstones(namespace, token_hash)
      values ('manager', v_hash)
      on conflict (namespace, token_hash) do nothing;
    end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_active_sessions(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.revoke_manager_sessions(p_manager_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_deleted integer;
begin
  v_deleted := public.revoke_manager_active_sessions(p_manager_id, null);
  -- Pending handoffs are bearer sessions too.  Their delete trigger records
  -- exact-pair manager_pending evidence, including an account-wide revoke.
  for v_hash in
    select token_hash
    from public.manager_pending_sessions
    where manager_id = p_manager_id and confirmed_at is null
    order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.manager_pending_sessions
    where manager_id = p_manager_id
      and token_hash = v_hash
      and confirmed_at is null;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_manager_sessions(uuid) to service_role;

-- The deterministic retry succeeds only if its exact live row remains valid.
-- A terminal tombstone for this exact hash+reservation pair is never revived.
create or replace function public.create_manager_session_pending(
  p_manager_id uuid,
  p_reservation_id uuid,
  p_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  v_pending public.manager_pending_sessions%rowtype;
  v_hash text;
begin
  if p_reservation_id is null or p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.lock_session_lifecycle_hash(v_hash);
  perform public.expire_manager_pending_session_hash(v_hash);

  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = 'manager_pending'
      and token_hash = v_hash
      and pending_reservation_id = p_reservation_id
  ) then
    return false;
  end if;

  -- All token-aware paths acquire the bearer lock before this reservation row.
  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id
  for update;
  if v_reservation.id is null
    or v_reservation.consumed_at is not null
    or v_reservation.expires_at <= clock_timestamp() then
    return false;
  end if;

  select * into v_pending
  from public.manager_pending_sessions
  where reservation_id = p_reservation_id
  for update;
  if v_pending.id is not null then
    return v_pending.manager_id = p_manager_id
      and v_pending.token_hash = v_hash
      and v_pending.confirmed_at is null
      and v_pending.expires_at > clock_timestamp();
  end if;

  select * into v_account
  from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then return false; end if;

  insert into public.manager_pending_sessions(
    manager_id, restaurant_id, token_hash, reservation_id, expires_at
  ) values (
    v_account.id, v_account.restaurant_id, v_hash, p_reservation_id,
    clock_timestamp() + interval '60 seconds'
  );
  return true;
end;
$$;
revoke all on function public.create_manager_session_pending(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid, uuid, text)
  to service_role;

-- Confirmation takes the bearer lock before it derives any state.  A revoke
-- for that bearer therefore either completes first (confirm returns false) or
-- waits and revokes the committed active session; it can never report UNKNOWN
-- while confirmation creates a live bearer.
create or replace function public.confirm_manager_session(
  p_token text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_pending public.manager_pending_sessions%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.lock_session_lifecycle_hash(v_hash);
  perform public.expire_manager_pending_session_hash(v_hash);

  select * into v_pending
  from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id
  for update;
  if v_pending.id is null then return false; end if;

  if v_pending.confirmed_at is not null then
    return exists (
      select 1
      from public.manager_sessions s
      join public.owner_login_rate_limit_reservations r on r.id = v_pending.reservation_id
      where s.manager_id = v_pending.manager_id
        and s.token_hash = v_hash
        and s.expires_at > clock_timestamp()
        and r.outcome = 'succeeded'
        and r.consumed_at is not null
    );
  end if;

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id
  for update;
  if v_pending.expires_at <= clock_timestamp()
    or v_reservation.id is null
    or v_reservation.consumed_at is not null
    or v_reservation.expires_at <= clock_timestamp() then
    return false;
  end if;

  -- Active bearer hashes are lock-ordered by the helper.  The pending hash is
  -- already exclusively held and is not an active row, so no lock cycle is
  -- possible with an account-wide active-session revoke.
  perform public.revoke_manager_active_sessions(v_pending.manager_id, null);
  insert into public.manager_sessions(manager_id, restaurant_id, token_hash, expires_at)
  values (
    v_pending.manager_id, v_pending.restaurant_id, v_hash,
    clock_timestamp() + interval '12 hours'
  );
  if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
    raise exception 'RESERVATION_NOT_CONSUMABLE' using errcode = 'R0001';
  end if;
  update public.manager_pending_sessions
  set confirmed_at = clock_timestamp()
  where id = v_pending.id and confirmed_at is null;
  if not found then raise exception 'CONFIRM_STATE_CHANGED' using errcode = 'R0003'; end if;
  return true;
end;
$$;
revoke all on function public.confirm_manager_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text, uuid) to service_role;

create or replace function public.cleanup_pending_manager_session(
  p_token text,
  p_reservation_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.lock_session_lifecycle_hash(v_hash);
  perform public.expire_manager_pending_session_hash(v_hash);

  delete from public.manager_pending_sessions
  where token_hash = v_hash
    and reservation_id = p_reservation_id
    and confirmed_at is null;
  if found then return true; end if;
  return exists (
    select 1 from public.revoked_session_tombstones
    where namespace = 'manager_pending'
      and token_hash = v_hash
      and pending_reservation_id = p_reservation_id
  );
end;
$$;
revoke all on function public.cleanup_pending_manager_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.cleanup_pending_manager_session(text, uuid) to service_role;

create or replace function public.revoke_manager_session_by_token(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_pending_reservation_id uuid;
begin
  if p_token is null or length(p_token) < 1 or length(p_token) > 200 then
    return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.lock_session_lifecycle_hash(v_hash);
  perform public.expire_manager_pending_session_hash(v_hash);

  delete from public.manager_sessions where token_hash = v_hash;
  if found then
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values ('manager', v_hash) on conflict (namespace, token_hash) do nothing;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;

  delete from public.manager_pending_sessions
  where token_hash = v_hash and confirmed_at is null
  returning reservation_id into v_pending_reservation_id;
  if v_pending_reservation_id is not null then
    -- The delete trigger has atomically recorded this exact pair.
    return jsonb_build_object('verdict', 'REVOKED');
  end if;

  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace in ('manager', 'manager_pending') and token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;
  if exists (select 1 from public.staff_sessions where token_hash = v_hash)
     or exists (
       select 1 from public.revoked_session_tombstones
       where namespace in ('super_admin', 'area_manager') and token_hash = v_hash
     ) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;
  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_manager_session_by_token(text)
  from public, anon, authenticated;
grant execute on function public.revoke_manager_session_by_token(text) to service_role;

-- Account-wide staff revocation uses the same ordered bearer locking protocol
-- as manager bulk revocation before it deletes and tombstones each live row.
create or replace function public.revoke_staff_sessions(p_kind text, p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_deleted integer := 0;
begin
  if p_kind not in ('super_admin', 'area_manager') then return 0; end if;
  for v_hash in
    select token_hash
    from public.staff_sessions
    where session_kind = p_kind and account_id = p_account_id
    order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.staff_sessions
    where session_kind = p_kind and account_id = p_account_id and token_hash = v_hash;
    if found then
      v_deleted := v_deleted + 1;
      insert into public.revoked_session_tombstones(namespace, token_hash)
      values (p_kind, v_hash) on conflict (namespace, token_hash) do nothing;
    end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_staff_sessions(text, uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_staff_sessions(text, uuid) to service_role;

-- Staff revocation shares the same hash lock, including its cross-namespace
-- checks, so it cannot take a mixed snapshot of a manager handoff.
create or replace function public.revoke_staff_session_by_token(p_kind text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
begin
  if p_kind not in ('super_admin', 'area_manager')
     or p_token is null or length(p_token) < 1 or length(p_token) > 200 then
    return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.lock_session_lifecycle_hash(v_hash);
  perform public.expire_manager_pending_session_hash(v_hash);

  delete from public.staff_sessions
  where session_kind = p_kind and token_hash = v_hash;
  if found then
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values (p_kind, v_hash) on conflict (namespace, token_hash) do nothing;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;
  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = p_kind and token_hash = v_hash
  ) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;
  if exists (
       select 1 from public.staff_sessions
       where token_hash = v_hash and session_kind <> p_kind
     )
     or exists (select 1 from public.manager_sessions where token_hash = v_hash)
     or exists (
       select 1 from public.manager_pending_sessions
       where token_hash = v_hash and confirmed_at is null
     )
     or exists (
       select 1 from public.revoked_session_tombstones
       where token_hash = v_hash and namespace <> p_kind
     ) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;
  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_staff_session_by_token(text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_staff_session_by_token(text, text) to service_role;

-- Reconciliation takes the same lock before reading all three lifecycle rows.
-- Confirmation therefore cannot commit after this reads FAILED; it waits and a
-- later reconciliation sees the committed success instead.
create or replace function public.reconcile_manager_session_handoff(
  p_token text,
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hash text;
  v_pending public.manager_pending_sessions%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return 'UNKNOWN';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  perform public.lock_session_lifecycle_hash(v_hash);
  perform public.expire_manager_pending_session_hash(v_hash);

  select * into v_pending
  from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id;
  if v_pending.id is null then
    if exists (
      select 1 from public.revoked_session_tombstones
      where namespace = 'manager_pending'
        and token_hash = v_hash
        and pending_reservation_id = p_reservation_id
    ) then return 'FAILED'; end if;
    return 'UNKNOWN';
  end if;

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id;
  if v_reservation.id is null then return 'UNKNOWN'; end if;
  if v_pending.confirmed_at is not null then
    if v_reservation.outcome = 'succeeded'
      and v_reservation.consumed_at is not null
      and exists (
        select 1 from public.manager_sessions
        where manager_id = v_pending.manager_id
          and restaurant_id = v_pending.restaurant_id
          and token_hash = v_hash
          and expires_at > clock_timestamp()
      ) then return 'SUCCEEDED'; end if;
    return 'FAILED';
  end if;
  if v_pending.expires_at > clock_timestamp()
    and v_reservation.consumed_at is null
    and v_reservation.expires_at > clock_timestamp() then
    return 'PENDING';
  end if;
  return 'FAILED';
end;
$$;
revoke all on function public.reconcile_manager_session_handoff(text, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_manager_session_handoff(text, uuid) to service_role;

-- Retention uses the same bearer-before-reservation order.  A reservation may
-- still cascade-delete a pending row, but the BEFORE DELETE trigger above is
-- the final safety net for every FK delete path.
create or replace function public.cleanup_owner_login_rate_limits()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
  v_hash text;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  reservations_deleted integer := 0;
  buckets_deleted integer;
begin
  for v_id in
    select r.id
    from public.owner_login_rate_limit_reservations r
    where (r.consumed_at < clock_timestamp() - interval '1 day'
        or r.expires_at < clock_timestamp() - interval '1 day')
      and not exists (
        select 1 from public.staff_reset_attempts a where a.reservation_id = r.id
      )
    order by coalesce(r.consumed_at, r.expires_at), r.id
    limit 1000
  loop
    select p.token_hash into v_hash
    from public.manager_pending_sessions p
    where p.reservation_id = v_id and p.confirmed_at is null;
    if v_hash is not null then
      perform public.lock_session_lifecycle_hash(v_hash);
    end if;
    select * into v_reservation
    from public.owner_login_rate_limit_reservations
    where id = v_id
    for update;
    if v_reservation.id is null
      or not (v_reservation.consumed_at < clock_timestamp() - interval '1 day'
              or v_reservation.expires_at < clock_timestamp() - interval '1 day')
      or exists (select 1 from public.staff_reset_attempts a where a.reservation_id = v_id) then
      continue;
    end if;
    delete from public.owner_login_rate_limit_reservations where id = v_id;
    if found then reservations_deleted := reservations_deleted + 1; end if;
  end loop;

  with doomed as (
    select b.bucket_hash
    from public.owner_login_rate_limit_buckets b
    where b.window_started_at < clock_timestamp() - interval '1 day'
      and not exists (
        select 1 from public.owner_login_rate_limit_reservations r
        where r.client_bucket_hash = b.bucket_hash or r.ip_bucket_hash = b.bucket_hash
      )
    order by b.window_started_at, b.bucket_hash
    limit 1000
    for update skip locked
  )
  delete from public.owner_login_rate_limit_buckets b
  using doomed d
  where b.bucket_hash = d.bucket_hash;
  get diagnostics buckets_deleted = row_count;

  return jsonb_build_object(
    'reservations_deleted', reservations_deleted,
    'buckets_deleted', buckets_deleted
  );
end;
$$;
revoke all on function public.cleanup_owner_login_rate_limits()
  from public, anon, authenticated;
grant execute on function public.cleanup_owner_login_rate_limits() to service_role;

-- Existing expired rows receive trigger-backed evidence at migration time.
select public.expire_manager_pending_sessions();
