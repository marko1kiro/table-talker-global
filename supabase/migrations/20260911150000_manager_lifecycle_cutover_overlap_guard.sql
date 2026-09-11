-- R12-B (blocker P0-2): legacy invalid bearer-hash overlap repair and manager
-- lifecycle migration cutover locking.
--
-- Invariant being enforced: one manager bearer hash is exactly one global
-- manager lifecycle. R11 (20260911130000) introduced the permanent anti-reuse
-- register and made a FRESH mint honour that invariant, but its cutover had
-- three holes:
--
--   1. The register backfill ran without holding the lifecycle tables, so a
--      legacy transaction still running the pre-R11 functions could commit a
--      pending row after the backfill snapshot and never be inspected.
--   2. Nothing repaired legacy rows that already violate the invariant: an
--      unconfirmed `manager_pending_sessions` row whose hash is also an active
--      `manager_sessions` row, or already carries a terminal `manager` /
--      `manager_pending` tombstone. Those rows are a terminal bearer waiting
--      to be resurrected.
--   3. The exact retry branch of `create_manager_session_pending` and the
--      activation branch of `confirm_manager_session` never asked the overlap
--      question, so either could hand the terminal bearer back out.
--
-- This migration closes all three, forward-only, without rewriting any earlier
-- migration:
--
--   * It takes ACCESS EXCLUSIVE on every manager lifecycle table FIRST, so no
--     legacy or concurrent lifecycle write can interleave with the repair or
--     with the function cutover, and it then proves the locks are held.
--   * It repairs by terminalizing (deleting) invalid unconfirmed pending rows.
--     The R11 BEFORE DELETE trigger records the exact `manager_pending`
--     tombstone (hash + reservation) and the permanent register entry, so the
--     repaired state is terminal, replay-safe and reconcilable as FAILED.
--   * It re-issues the overlap question independently in the exact retry, in
--     confirmation and in reconciliation, so a row that somehow overlaps after
--     the cutover is still fail-closed instead of confirmable.
--
-- Deliberately NOT classified as invalid: a CONFIRMED pending row paired with
-- the active session carrying the same hash. That is the normal, successful
-- handoff end state, and so is a confirmed row whose active session was later
-- revoked (it keeps a `manager` tombstone). The repair therefore only ever
-- considers `confirmed_at is null` rows.
--
-- Raw bearers are never stored, logged or returned here: the repair works on
-- SHA-256 hashes and reports counts only.

-- 1. Cutover lock. The order is the order the pre-R11/R11 lifecycle paths touch
--    these tables (pending child -> active session -> tombstone evidence ->
--    register), so a legacy writer queues behind us instead of holding half of
--    what we need. If PostgreSQL does detect a cycle with an in-flight legacy
--    transaction it aborts THIS migration (40P01) rather than letting an
--    unlocked write slip through the cutover: fail-closed and simply retryable.
lock table
  public.manager_pending_sessions,
  public.manager_sessions,
  public.revoked_session_tombstones,
  public.manager_bearer_lifecycle_hashes
  in access exclusive mode;

-- 2. Prove the cutover locks are actually held for the remainder of this
--    migration. `lock table` only lasts for the surrounding transaction, so
--    applying this file statement-by-statement (autocommit) would repair and
--    swap the functions while legacy writers are still free to interleave.
--    That must fail loudly instead of appearing to succeed.
do $$
declare
  v_held integer;
begin
  select count(distinct l.relation) into v_held
  from pg_catalog.pg_locks l
  where l.pid = pg_catalog.pg_backend_pid()
    and l.locktype = 'relation'
    and l.mode = 'AccessExclusiveLock'
    and l.granted
    and l.relation in (
      'public.manager_pending_sessions'::regclass,
      'public.manager_sessions'::regclass,
      'public.revoked_session_tombstones'::regclass,
      'public.manager_bearer_lifecycle_hashes'::regclass
    );
  if v_held <> 4 then
    raise exception 'MANAGER_LIFECYCLE_CUTOVER_NOT_LOCKED'
      using errcode = '55000',
        detail = 'the manager lifecycle cutover holds ' || v_held || ' of 4 table locks',
        hint = 'apply this migration inside a single transaction block';
  end if;
end
$$;

-- 3. Re-run the permanent anti-reuse backfill under the cutover locks. R11 did
--    this unlocked; anything a legacy transaction committed afterwards is
--    picked up here. Idempotent by construction.
insert into public.manager_bearer_lifecycle_hashes(token_hash)
select token_hash from public.manager_sessions
union
select token_hash from public.manager_pending_sessions
union
select token_hash from public.revoked_session_tombstones
where namespace in ('manager', 'manager_pending')
on conflict (token_hash) do nothing;

-- 4. The single overlap question, asked in exactly one place so the cutover
--    repair and every runtime path cannot drift apart. It answers "is this
--    bearer hash already owned by another manager lifecycle?" and returns a
--    stable, token-free reason code (null = free). Callers must only ask it
--    about a bearer that is supposed to be an UNCONFIRMED pending handoff:
--    a confirmed handoff legitimately shares its hash with the active session
--    it created, and with the `manager` tombstone that session leaves behind.
create or replace function public.manager_bearer_hash_conflict(p_token_hash text)
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  select case
    when exists (
      select 1 from public.manager_sessions where token_hash = p_token_hash
    ) then 'ACTIVE_MANAGER_SESSION'
    when exists (
      select 1 from public.revoked_session_tombstones
      where namespace = 'manager' and token_hash = p_token_hash
    ) then 'MANAGER_TOMBSTONE'
    when exists (
      select 1 from public.revoked_session_tombstones
      where namespace = 'manager_pending' and token_hash = p_token_hash
    ) then 'MANAGER_PENDING_TOMBSTONE'
  end;
$$;
revoke all on function public.manager_bearer_hash_conflict(text)
  from public, anon, authenticated, service_role;

-- 5. Repair: terminalize every legacy unconfirmed pending row whose bearer is
--    owned by another lifecycle. The delete fires the R11 BEFORE DELETE
--    trigger, which writes the exact `manager_pending` tombstone plus the
--    register entry, so the bearer ends terminal and reconciliation answers
--    FAILED for the exact pair instead of PENDING. Counts only are reported.
do $$
declare
  v_repaired integer;
begin
  with invalid as (
    select p.id
    from public.manager_pending_sessions p
    where p.confirmed_at is null
      and public.manager_bearer_hash_conflict(p.token_hash) is not null
  )
  delete from public.manager_pending_sessions p
  using invalid i
  where p.id = i.id;
  get diagnostics v_repaired = row_count;
  if v_repaired > 0 then
    raise notice
      'manager lifecycle cutover terminalized % unconfirmed pending row(s) with an overlapping bearer lifecycle',
      v_repaired;
  end if;
end
$$;

-- 6. Runtime cutover. Bodies are R11's, with the overlap question added to the
--    exact retry, to activation and to reconciliation. Lock order is unchanged:
--    restaurant parent -> manager account -> manager advisory -> bearer
--    advisory -> reservation parent -> pending child.
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
    -- Deterministic exact retry. It may only re-affirm a live row; it must
    -- never re-affirm a bearer another lifecycle owns, so it asks the overlap
    -- question independently of mint and of the cutover repair. An overlapping
    -- row is terminalized here too: leaving it live would keep a terminal
    -- bearer confirmable.
    if v_pending.manager_id is distinct from p_manager_id
       or v_pending.token_hash is distinct from v_hash
       or v_pending.confirmed_at is not null
       or v_pending.expires_at <= clock_timestamp() then
      return false;
    end if;
    if public.manager_bearer_hash_conflict(v_hash) is not null then
      delete from public.manager_pending_sessions
      where id = v_pending.id and confirmed_at is null;
      return false;
    end if;
    return true;
  end if;
  -- One hash is one global manager lifecycle, irrespective of reservation. The
  -- register covers every hash ever issued; the overlap question covers live
  -- and terminal rows that predate the register.
  if exists (select 1 from public.manager_bearer_lifecycle_hashes where token_hash = v_hash)
     or exists (select 1 from public.manager_pending_sessions where token_hash = v_hash)
     or public.manager_bearer_hash_conflict(v_hash) is not null then
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
    -- Normal completed handoff: this hash is SUPPOSED to be the active session
    -- as well, so the overlap question does not apply to this branch.
    return v_reservation.id is not null and v_reservation.outcome = 'succeeded'
      and v_reservation.consumed_at is not null and exists (
        select 1 from public.manager_sessions where manager_id = v_pending.manager_id
          and token_hash = v_hash and expires_at > clock_timestamp());
  end if;
  -- Activation is the last point at which a terminal bearer could be
  -- resurrected, and it must be checked BEFORE the supersede-revoke below:
  -- that revoke would delete (and tombstone) the very active row that proves
  -- the overlap. Fail closed and terminalize, so the invalid row cannot be
  -- retried and reconciliation resolves to FAILED.
  if public.manager_bearer_hash_conflict(v_hash) is not null then
    delete from public.manager_pending_sessions
    where id = v_pending.id and confirmed_at is null;
    return false;
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
  -- An unconfirmed row whose bearer is owned by another lifecycle is never
  -- confirmable (see confirm_manager_session), so it must not be reported as
  -- still PENDING. This read-only classification keeps the client's verdict
  -- consistent with the fail-closed activation path.
  if public.manager_bearer_hash_conflict(v_hash) is not null then return 'FAILED'; end if;
  if v_pending.expires_at > clock_timestamp() and v_reservation.consumed_at is null
    and v_reservation.expires_at > clock_timestamp() then return 'PENDING'; end if;
  return 'FAILED';
end;
$$;
revoke all on function public.reconcile_manager_session_handoff(text, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_manager_session_handoff(text, uuid) to service_role;
