-- R10: forward corrections for manager pending lifecycle locking and evidence.
--
-- This migration intentionally overrides R9 functions/triggers rather than editing
-- deployed migration history.
--
-- Lock hierarchy (all locks are transaction-scoped advisory locks):
--
--   1. manager account: hashtextextended('manager:' || manager UUID, 916)
--   2. bearer hash:    hashtextextended(sha256(bearer), 917), lexical order
--                       when an operation has more than one bearer
--   3. reservation row: SELECT ... FOR UPDATE
--
-- Operations which can identify a manager take its account lock before any
-- bearer lock. Token-only operations make an unlocked discovery read solely
-- to identify that manager, then re-read after taking the hierarchy; an
-- unknown hash takes only its bearer lock and never subsequently takes an
-- account lock. Global expiry and reservation retention deliberately process
-- one deterministic manager account per invocation, taking manager -> bearer
-- (and then reservation where needed); they never retain unrelated account
-- locks while moving between accounts. An FK cascade already holds its parent reservation
-- and child-row locks before its trigger fires; it must not request account or
-- bearer advisory locks after that parent lock. Its trigger therefore only
-- records immutable evidence; competing lifecycle RPCs wait on the deleted
-- child row and re-read after their normal hierarchy. This makes
-- confirm/newest-wins, account revoke, password/status/reset revocation,
-- retention cascades, and direct token cleanup compatible. The raw bearer is accepted only as an RPC argument;
-- this migration stores SHA-256 hashes only.

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

-- Stable manager/account serialization point for lifecycle operations which
-- may touch more than one bearer (newest-wins, account revoke, password,
-- status and reset callers). Seed 916 is retained from R8, but namespace
-- prefixes prevent a manager UUID from colliding with a staff account UUID.
create or replace function public.lock_manager_session_lifecycle(p_manager_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manager:' || p_manager_id::text, 916)
  );
$$;
revoke all on function public.lock_manager_session_lifecycle(uuid)
  from public, anon, authenticated, service_role;

-- Staff account-wide revocation/minting has the same account-before-bearer
-- discipline. It is separate from manager locks even if an impossible UUID
-- collision were introduced by a data import.
create or replace function public.lock_staff_session_lifecycle(p_kind text, p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_kind not in ('super_admin', 'area_manager') then
    raise exception 'INVALID_KIND' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('staff:' || p_kind || ':' || p_account_id::text, 916)
  );
end;
$$;
revoke all on function public.lock_staff_session_lifecycle(text, uuid)
  from public, anon, authenticated, service_role;

-- A delete may be initiated by cleanup/revoke/expiry or by an FK cascade from
-- a reservation, manager, or restaurant. Recording evidence in BEFORE DELETE
-- makes every unconfirmed deletion safe, including cascades which cannot call
-- an RPC first. Do NOT take an advisory lock here: an FK cascade has already
-- locked its parent reservation, and requesting manager/bearer after it would
-- invert the required manager -> bearer -> reservation hierarchy. The child
-- row lock held by DELETE serializes this trigger with lifecycle RPCs, which
-- re-read after acquiring their normal advisory hierarchy.
create or replace function public.tombstone_unconfirmed_manager_pending_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.confirmed_at is null then
    -- The first terminal reservation is immutable evidence. A second live
    -- lifecycle for this hash is rejected at creation; ON CONFLICT is only a
    -- defensive no-op for rows that predate that guard, never evidence for a
    -- different reservation. See the trigger comment above for why this path
    -- intentionally relies on DELETE's row lock rather than advisory locks.
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
  v_manager_id uuid;
  v_deleted integer;
begin
  -- Discovery deliberately takes no lifecycle lock. Once a manager is known,
  -- re-read under manager -> bearer; an absent/raced row simply cannot expire.
  select manager_id into v_manager_id
  from public.manager_pending_sessions
  where token_hash = p_token_hash and confirmed_at is null;
  if v_manager_id is not null then
    perform public.lock_manager_session_lifecycle(v_manager_id);
  end if;
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

create or replace function public.expire_manager_pending_sessions()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manager_id uuid;
  v_hash text;
  v_deleted integer := 0;
  v_count integer;
begin
  -- One account per invocation. Transaction advisory locks cannot be released
  -- early, so retaining a cross-account sweep here would hold unrelated
  -- manager/bearer locks and permit opposite account orders. The next run
  -- continues with the next deterministic manager; each pending TTL is only
  -- 60 seconds, so this is housekeeping rather than authorization.
  select p.manager_id into v_manager_id
  from public.manager_pending_sessions p
  where p.confirmed_at is null and p.expires_at <= clock_timestamp()
  order by p.manager_id
  limit 1;
  if v_manager_id is null then return 0; end if;
  perform public.lock_manager_session_lifecycle(v_manager_id);
  for v_hash in
    select token_hash
    from public.manager_pending_sessions
    where manager_id = v_manager_id
      and confirmed_at is null and expires_at <= clock_timestamp()
    order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.manager_pending_sessions
    where manager_id = v_manager_id and token_hash = v_hash
      and confirmed_at is null and expires_at <= clock_timestamp();
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
  perform public.lock_manager_session_lifecycle(p_manager_id);
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
  perform public.lock_manager_session_lifecycle(p_manager_id);
  v_deleted := public.revoke_manager_active_sessions(p_manager_id, null);
  for v_hash in
    select token_hash
    from public.manager_pending_sessions
    where manager_id = p_manager_id and confirmed_at is null
    order by token_hash
  loop
    perform public.lock_session_lifecycle_hash(v_hash);
    delete from public.manager_pending_sessions
    where manager_id = p_manager_id and token_hash = v_hash
      and confirmed_at is null;
    if found then v_deleted := v_deleted + 1; end if;
  end loop;
  return v_deleted;
end;
$$;
revoke all on function public.revoke_manager_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_manager_sessions(uuid) to service_role;

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
  perform public.lock_manager_session_lifecycle(p_manager_id);
  perform public.lock_session_lifecycle_hash(v_hash);

  -- A manager_pending hash has one immutable lifecycle identity. The exact
  -- pair remains in the tombstone for reconciliation/cleanup; any pair blocks
  -- re-minting so it cannot be repurposed for another reservation.
  if exists (
    select 1 from public.revoked_session_tombstones
    where namespace = 'manager_pending' and token_hash = v_hash
  ) then return false; end if;

  select * into v_reservation
  from public.owner_login_rate_limit_reservations
  where id = p_reservation_id
  for update;
  if v_reservation.id is null
    or v_reservation.consumed_at is not null
    or v_reservation.expires_at <= clock_timestamp() then return false; end if;

  select * into v_pending from public.manager_pending_sessions
  where reservation_id = p_reservation_id for update;
  if v_pending.id is not null then
    return v_pending.manager_id = p_manager_id and v_pending.token_hash = v_hash
      and v_pending.confirmed_at is null and v_pending.expires_at > clock_timestamp();
  end if;

  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then return false; end if;
  insert into public.manager_pending_sessions(
    manager_id, restaurant_id, token_hash, reservation_id, expires_at
  ) values (v_account.id, v_account.restaurant_id, v_hash, p_reservation_id,
    clock_timestamp() + interval '60 seconds');
  return true;
end;
$$;
revoke all on function public.create_manager_session_pending(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid, uuid, text)
  to service_role;

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
  v_manager_id uuid;
  v_pending public.manager_pending_sessions%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then
    return false;
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  -- Unlocked discovery is not authorization. It only chooses the account lock;
  -- every state decision is repeated after manager -> bearer is held.
  select manager_id into v_manager_id from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id;
  if v_manager_id is null then
    perform public.lock_session_lifecycle_hash(v_hash);
    return false;
  end if;
  perform public.lock_manager_session_lifecycle(v_manager_id);
  perform public.lock_session_lifecycle_hash(v_hash);

  select * into v_pending from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id for update;
  if v_pending.id is null then return false; end if;
  if v_pending.confirmed_at is not null then
    return exists (
      select 1 from public.manager_sessions s
      join public.owner_login_rate_limit_reservations r on r.id = v_pending.reservation_id
      where s.manager_id = v_pending.manager_id and s.token_hash = v_hash
        and s.expires_at > clock_timestamp() and r.outcome = 'succeeded'
        and r.consumed_at is not null
    );
  end if;
  select * into v_reservation from public.owner_login_rate_limit_reservations
  where id = p_reservation_id for update;
  if v_pending.expires_at <= clock_timestamp() or v_reservation.id is null
    or v_reservation.consumed_at is not null
    or v_reservation.expires_at <= clock_timestamp() then return false; end if;

  perform public.revoke_manager_active_sessions(v_pending.manager_id, null);
  insert into public.manager_sessions(manager_id, restaurant_id, token_hash, expires_at)
  values (v_pending.manager_id, v_pending.restaurant_id, v_hash,
    clock_timestamp() + interval '12 hours');
  if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
    raise exception 'RESERVATION_NOT_CONSUMABLE' using errcode = 'R0001';
  end if;
  update public.manager_pending_sessions set confirmed_at = clock_timestamp()
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
declare v_hash text; v_manager_id uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then return false; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select manager_id into v_manager_id from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id and confirmed_at is null;
  if v_manager_id is not null then perform public.lock_manager_session_lifecycle(v_manager_id); end if;
  perform public.lock_session_lifecycle_hash(v_hash);
  delete from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id and confirmed_at is null;
  if found then return true; end if;
  return exists (select 1 from public.revoked_session_tombstones
    where namespace = 'manager_pending' and token_hash = v_hash
      and pending_reservation_id = p_reservation_id);
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
declare v_hash text; v_manager_id uuid; v_pending_reservation_id uuid;
begin
  if p_token is null or length(p_token) < 1 or length(p_token) > 200 then
    return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select coalesce(
    (select manager_id from public.manager_sessions where token_hash = v_hash),
    (select manager_id from public.manager_pending_sessions where token_hash = v_hash and confirmed_at is null)
  ) into v_manager_id;
  if v_manager_id is not null then perform public.lock_manager_session_lifecycle(v_manager_id); end if;
  perform public.lock_session_lifecycle_hash(v_hash);
  delete from public.manager_sessions where token_hash = v_hash;
  if found then
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values ('manager', v_hash) on conflict (namespace, token_hash) do nothing;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;
  delete from public.manager_pending_sessions where token_hash = v_hash and confirmed_at is null
  returning reservation_id into v_pending_reservation_id;
  if v_pending_reservation_id is not null then return jsonb_build_object('verdict', 'REVOKED'); end if;
  if exists (select 1 from public.revoked_session_tombstones
    where namespace in ('manager', 'manager_pending') and token_hash = v_hash) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;
  if exists (select 1 from public.staff_sessions where token_hash = v_hash)
    or exists (select 1 from public.revoked_session_tombstones
      where namespace in ('super_admin', 'area_manager') and token_hash = v_hash) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;
  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_manager_session_by_token(text)
  from public, anon, authenticated;
grant execute on function public.revoke_manager_session_by_token(text) to service_role;

create or replace function public.revoke_staff_sessions(p_kind text, p_account_id uuid)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_hash text; v_deleted integer := 0;
begin
  if p_kind not in ('super_admin', 'area_manager') then return 0; end if;
  perform public.lock_staff_session_lifecycle(p_kind, p_account_id);
  for v_hash in select token_hash from public.staff_sessions
    where session_kind = p_kind and account_id = p_account_id order by token_hash
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

create or replace function public.revoke_staff_session_by_token(p_kind text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_hash text; v_account_id uuid;
begin
  if p_kind not in ('super_admin', 'area_manager') or p_token is null
    or length(p_token) < 1 or length(p_token) > 200 then return jsonb_build_object('verdict', 'UNKNOWN_TOKEN'); end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select account_id into v_account_id from public.staff_sessions
  where session_kind = p_kind and token_hash = v_hash;
  if v_account_id is not null then perform public.lock_staff_session_lifecycle(p_kind, v_account_id); end if;
  perform public.lock_session_lifecycle_hash(v_hash);
  delete from public.staff_sessions where session_kind = p_kind and token_hash = v_hash;
  if found then
    insert into public.revoked_session_tombstones(namespace, token_hash)
    values (p_kind, v_hash) on conflict (namespace, token_hash) do nothing;
    return jsonb_build_object('verdict', 'REVOKED');
  end if;
  if exists (select 1 from public.revoked_session_tombstones where namespace = p_kind and token_hash = v_hash) then
    return jsonb_build_object('verdict', 'ALREADY_INACTIVE');
  end if;
  if exists (select 1 from public.staff_sessions where token_hash = v_hash and session_kind <> p_kind)
    or exists (select 1 from public.manager_sessions where token_hash = v_hash)
    or exists (select 1 from public.manager_pending_sessions where token_hash = v_hash and confirmed_at is null)
    or exists (select 1 from public.revoked_session_tombstones where token_hash = v_hash and namespace <> p_kind) then
    return jsonb_build_object('verdict', 'KIND_MISMATCH');
  end if;
  return jsonb_build_object('verdict', 'UNKNOWN_TOKEN');
end;
$$;
revoke all on function public.revoke_staff_session_by_token(text, text)
  from public, anon, authenticated;
grant execute on function public.revoke_staff_session_by_token(text, text) to service_role;

create or replace function public.reconcile_manager_session_handoff(
  p_token text,
  p_reservation_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_hash text; v_manager_id uuid; v_pending public.manager_pending_sessions%rowtype;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_reservation_id is null then return 'UNKNOWN'; end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select manager_id into v_manager_id from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id;
  if v_manager_id is not null then perform public.lock_manager_session_lifecycle(v_manager_id); end if;
  perform public.lock_session_lifecycle_hash(v_hash);
  select * into v_pending from public.manager_pending_sessions
  where token_hash = v_hash and reservation_id = p_reservation_id;
  if v_pending.id is null then
    if exists (select 1 from public.revoked_session_tombstones
      where namespace = 'manager_pending' and token_hash = v_hash
        and pending_reservation_id = p_reservation_id) then return 'FAILED'; end if;
    return 'UNKNOWN';
  end if;
  select * into v_reservation from public.owner_login_rate_limit_reservations where id = p_reservation_id;
  if v_reservation.id is null then return 'UNKNOWN'; end if;
  if v_pending.confirmed_at is not null then
    if v_reservation.outcome = 'succeeded' and v_reservation.consumed_at is not null
      and exists (select 1 from public.manager_sessions where manager_id = v_pending.manager_id
        and restaurant_id = v_pending.restaurant_id and token_hash = v_hash
        and expires_at > clock_timestamp()) then return 'SUCCEEDED'; end if;
    return 'FAILED';
  end if;
  if v_pending.expires_at > clock_timestamp() and v_reservation.consumed_at is null
    and v_reservation.expires_at > clock_timestamp() then return 'PENDING'; end if;
  return 'FAILED';
end;
$$;
revoke all on function public.reconcile_manager_session_handoff(text, uuid)
  from public, anon, authenticated;
grant execute on function public.reconcile_manager_session_handoff(text, uuid) to service_role;

create or replace function public.cleanup_owner_login_rate_limits()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_manager_id uuid;
  v_id uuid;
  v_hash text;
  v_reservation public.owner_login_rate_limit_reservations%rowtype;
  reservations_deleted integer := 0;
  buckets_deleted integer;
begin
  -- Retain the one-account-at-a-time property. The account lock is held only
  -- while handling hashes for one manager; manager UUID order is deterministic.
  select p.manager_id into v_manager_id
  from public.manager_pending_sessions p
  join public.owner_login_rate_limit_reservations r on r.id = p.reservation_id
  where (r.consumed_at < clock_timestamp() - interval '1 day'
      or r.expires_at < clock_timestamp() - interval '1 day')
    and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = r.id)
  order by p.manager_id
  limit 1;
  if v_manager_id is not null then
    perform public.lock_manager_session_lifecycle(v_manager_id);
    for v_id, v_hash in
      select r.id, p.token_hash
      from public.manager_pending_sessions p
      join public.owner_login_rate_limit_reservations r on r.id = p.reservation_id
      where p.manager_id = v_manager_id
        and (r.consumed_at < clock_timestamp() - interval '1 day'
          or r.expires_at < clock_timestamp() - interval '1 day')
        and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = r.id)
      order by p.token_hash, r.id
    loop
      perform public.lock_session_lifecycle_hash(v_hash);
      select * into v_reservation from public.owner_login_rate_limit_reservations
      where id = v_id for update;
      if v_reservation.id is not null
        and (v_reservation.consumed_at < clock_timestamp() - interval '1 day'
          or v_reservation.expires_at < clock_timestamp() - interval '1 day')
        and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = v_id) then
        delete from public.owner_login_rate_limit_reservations where id = v_id;
        if found then reservations_deleted := reservations_deleted + 1; end if;
      end if;
    end loop;
  end if;

  -- Reservations with no pending bearer take no lifecycle lock and may be
  -- collected in the same bounded invocation without crossing account scope.
  with doomed as (
    select r.id from public.owner_login_rate_limit_reservations r
    where (r.consumed_at < clock_timestamp() - interval '1 day'
        or r.expires_at < clock_timestamp() - interval '1 day')
      and not exists (select 1 from public.manager_pending_sessions p where p.reservation_id = r.id)
      and not exists (select 1 from public.staff_reset_attempts a where a.reservation_id = r.id)
    order by coalesce(r.consumed_at, r.expires_at), r.id limit 1000 for update skip locked
  )
  delete from public.owner_login_rate_limit_reservations r using doomed d where r.id = d.id;
  get diagnostics buckets_deleted = row_count;
  reservations_deleted := reservations_deleted + buckets_deleted;

  with doomed as (
    select b.bucket_hash from public.owner_login_rate_limit_buckets b
    where b.window_started_at < clock_timestamp() - interval '1 day'
      and not exists (select 1 from public.owner_login_rate_limit_reservations r
        where r.client_bucket_hash = b.bucket_hash or r.ip_bucket_hash = b.bucket_hash)
    order by b.window_started_at, b.bucket_hash limit 1000 for update skip locked
  )
  delete from public.owner_login_rate_limit_buckets b using doomed d where b.bucket_hash = d.bucket_hash;
  get diagnostics buckets_deleted = row_count;
  return jsonb_build_object('reservations_deleted', reservations_deleted, 'buckets_deleted', buckets_deleted);
end;
$$;
revoke all on function public.cleanup_owner_login_rate_limits()
  from public, anon, authenticated;
grant execute on function public.cleanup_owner_login_rate_limits() to service_role;

-- manager_pending tombstones deliberately have NO scheduled destructive TTL.
-- Their exact pair drives reconciliation, and their hash is an anti-reuse
-- identity. Current horizons (60s pending, 12h active, reservation retention
-- for one day after expiry/consumption) do not by themselves prove a universal
-- deletion point under delayed clients/backups or future horizon changes. An
-- operator may invoke this explicit, service-only function only after
-- independently establishing a safe cutoff; it additionally refuses evidence
-- whose exact reservation still exists, because that pair can still be
-- reconciled. There is intentionally no default/scheduler.
create or replace function public.cleanup_manager_pending_tombstones(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_deleted integer;
begin
  if p_before is null or p_before > clock_timestamp() - interval '48 hours' then
    raise exception 'TOMBSTONE_CUTOFF_TOO_RECENT' using errcode = '22023';
  end if;
  delete from public.revoked_session_tombstones t
  where t.namespace = 'manager_pending' and t.revoked_at < p_before
    -- No reservation means this exact handoff can no longer be confirmed or
    -- reconciled by the public RPCs. Keep the evidence if its pair survives.
    and not exists (
      select 1 from public.owner_login_rate_limit_reservations r
      where r.id = t.pending_reservation_id
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function public.cleanup_manager_pending_tombstones(timestamptz)
  from public, anon, authenticated;
grant execute on function public.cleanup_manager_pending_tombstones(timestamptz) to service_role;

-- Minting a staff bearer must serialize with its account-wide revoker. The
-- random bearer is generated after account lock; it then has no preexisting
-- hash to lock, while any later bearer operation takes account -> hash.
create or replace function public.create_staff_session(p_kind text, p_account_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_token text; v_active boolean;
begin
  if p_kind not in ('super_admin', 'area_manager') then raise exception 'INVALID_KIND'; end if;
  perform public.lock_staff_session_lifecycle(p_kind, p_account_id);
  if p_kind = 'super_admin' then
    select status = 'aktif' into v_active from public.super_admin_accounts where id = p_account_id;
  else
    select status = 'aktif' into v_active from public.area_manager_accounts where id = p_account_id;
  end if;
  if v_active is not true then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.staff_sessions(session_kind, account_id, token_hash, expires_at)
  values (p_kind, p_account_id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
    clock_timestamp() + interval '12 hours');
  return v_token;
end;
$$;
revoke all on function public.create_staff_session(text, uuid)
  from public, anon, authenticated;
grant execute on function public.create_staff_session(text, uuid) to service_role;

-- Existing expired rows receive trigger-backed evidence at migration time.
select public.expire_manager_pending_sessions();
