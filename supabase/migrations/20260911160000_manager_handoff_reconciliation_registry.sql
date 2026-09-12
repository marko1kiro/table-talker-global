-- P1-5 (blocker, Task 2): durable exact manager-handoff reconciliation evidence.
--
-- THE HOLE THIS CLOSES
-- Every lifecycle verdict currently lives in rows that retention and FK
-- cascades are allowed to destroy. A CONFIRMED pending row deleted by the
-- manager/restaurant/reservation cascade leaves no `manager_pending` tombstone
-- at all (the evidence trigger only fires for unconfirmed rows), so
-- reconciliation degrades from FAILED to UNKNOWN once the source rows are gone
-- — the client can no longer tell "this handoff failed" from "this handoff
-- never existed".
--
-- THE FIX
-- One small, permanent, service-private registry keyed by the exact pair that
-- reconciliation is asked about: (token_hash, reservation_id). It stores the
-- SHA-256 bearer hash only — never a raw bearer — and has NO foreign keys, so
-- no cascade can ever remove the evidence its cascades are supposed to leave
-- behind. It has no destructive retention either, exactly like the R11
-- anti-reuse register.
--
-- State machine (monotone, terminal is final):
--   PENDING -> SUCCEEDED   PENDING -> FAILED   SUCCEEDED -> FAILED
--   FAILED  -> (nothing)   SUCCEEDED -> PENDING (rejected)
-- `SUCCEEDED -> FAILED` is required: an active bearer that is later revoked,
-- superseded or cascaded away IS a failed handoff for reconciliation purposes.
--
-- Writers (forward replacements only; earlier migrations are never edited):
--   * `create_manager_session_pending` records PENDING on a successful mint.
--   * `confirm_manager_session` records SUCCEEDED after activation and
--     rate-limit consumption both succeeded.
--   * every terminal deletion records FAILED. That is done in the two existing
--     BEFORE DELETE evidence triggers, because they are the only place that
--     also runs for FK cascades, which cannot call an RPC first: explicit
--     cleanup, TTL expiry, runtime overlap terminalization, reservation
--     cascade, manager cascade, restaurant cascade and retention all delete
--     through those tables.
--
-- Lock order is unchanged from R11/R12-B: restaurant parent -> manager account
-- -> manager advisory (916) -> bearer advisory (917) -> reservation parent ->
-- pending child. The registry is written LAST in every path and holds no
-- advisory lock inside a trigger, so it cannot invert that hierarchy; it has no
-- outgoing FKs, so it cascades to nothing.
--
-- Reconciliation gets only the minimum registry read needed to make the
-- durable-evidence contract observable: an exact FAILED row is now authoritative
-- when the source rows are gone. Making the registry fully authoritative
-- (SUCCEEDED/PENDING precedence and inconsistency handling) is Task 3.

-- 1. Cutover lock for the function/trigger swap. Without it a mint running the
--    pre-P1-5 body could create a live pending row with no registry evidence.
-- `LOCK TABLE` only works inside a transaction block, and CI (`supabase db
--    reset`) applies files statement-by-statement in autocommit. Delimit the
--    whole cutover as one explicit transaction so the lock and the guard below
--    hold under every runner: CI autocommit, the test harness (whole-file simple
--    query) and a manual `psql --single-transaction` apply alike.
begin;
lock table
  public.manager_pending_sessions,
  public.manager_sessions,
  public.revoked_session_tombstones,
  public.manager_bearer_lifecycle_hashes
  in access exclusive mode;

do $$
declare v_held integer;
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
        detail = 'the manager reconciliation cutover holds ' || v_held || ' of 4 table locks',
        hint = 'apply this migration inside a single transaction block';
  end if;
end
$$;

-- 2. The durable exact evidence table. No FKs on purpose: manager_id and
--    reservation_id are identity, not ownership, and a cascade must never
--    delete the proof of its own terminalization.
create table if not exists public.manager_handoff_reconciliation_registry (
  token_hash text not null,
  reservation_id uuid not null,
  manager_id uuid not null,
  state text not null check (state in ('PENDING', 'SUCCEEDED', 'FAILED')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (token_hash, reservation_id)
);
alter table public.manager_handoff_reconciliation_registry enable row level security;
revoke all on public.manager_handoff_reconciliation_registry
  from public, anon, authenticated, service_role;

-- 3. The only writer for exact-pair evidence. Private: no role may call it,
--    including service_role. Terminal states are never rewritten and a verdict
--    may only move forward along PENDING -> SUCCEEDED -> FAILED.
create or replace function public.record_manager_handoff_reconciliation(
  p_token_hash text,
  p_reservation_id uuid,
  p_manager_id uuid,
  p_state text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_token_hash is null or p_reservation_id is null or p_manager_id is null then
    return;
  end if;
  if p_state not in ('PENDING', 'SUCCEEDED', 'FAILED') then
    raise exception 'INVALID_RECONCILIATION_STATE' using errcode = '22023';
  end if;
  insert into public.manager_handoff_reconciliation_registry
    (token_hash, reservation_id, manager_id, state)
  values (p_token_hash, p_reservation_id, p_manager_id, p_state)
  on conflict (token_hash, reservation_id) do update
    set state = excluded.state,
        updated_at = clock_timestamp()
    where public.manager_handoff_reconciliation_registry.state <> 'FAILED'
      and case public.manager_handoff_reconciliation_registry.state
            when 'PENDING' then 1 when 'SUCCEEDED' then 2 else 3 end
        < case excluded.state when 'PENDING' then 1 when 'SUCCEEDED' then 2 else 3 end;
end;
$$;
revoke all on function public.record_manager_handoff_reconciliation(text, uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- Seed every surviving pre-P1-5 pending pair before the replacement writers are
-- exposed. Earlier terminal confirmed pairs whose source rows were already
-- cascaded away cannot be reconstructed and remain UNKNOWN by design.
insert into public.manager_handoff_reconciliation_registry(
  token_hash, reservation_id, manager_id, state
)
select
  p.token_hash,
  p.reservation_id,
  p.manager_id,
  case
    when p.confirmed_at is not null
      and r.outcome = 'succeeded'
      and r.consumed_at is not null
      and exists (
        select 1 from public.manager_sessions s
        where s.manager_id = p.manager_id
          and s.token_hash = p.token_hash
          and s.expires_at > clock_timestamp()
      ) then 'SUCCEEDED'
    when p.confirmed_at is null
      and p.expires_at > clock_timestamp()
      and r.consumed_at is null
      and r.expires_at > clock_timestamp() then 'PENDING'
    else 'FAILED'
  end
from public.manager_pending_sessions p
left join public.owner_login_rate_limit_reservations r on r.id = p.reservation_id;

-- 4. Active-session deletions carry no reservation id (manager_sessions has no
--    reservation column), so they terminate by hash. One hash is exactly one
--    global manager lifecycle (R11 register), so this can only ever touch that
--    lifecycle's own single registry row.
create or replace function public.fail_manager_handoff_reconciliation_hash(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_token_hash is null then return; end if;
  update public.manager_handoff_reconciliation_registry
     set state = 'FAILED', updated_at = clock_timestamp()
   where token_hash = p_token_hash and state <> 'FAILED';
end;
$$;
revoke all on function public.fail_manager_handoff_reconciliation_hash(text)
  from public, anon, authenticated, service_role;

-- 5. Evidence triggers: forward replacements of R11's, adding the terminal
--    registry write. Same rule as before — NO advisory lock here, because an
--    FK cascade already holds its parent row.
create or replace function public.tombstone_unconfirmed_manager_pending_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Keep hash evidence before registry evidence, matching active-row deletion
  -- order. FK cascades can race bare deletes, so both triggers acquire shared
  -- rows in one order without advisory locks here.
  if old.confirmed_at is null then
    insert into public.manager_bearer_lifecycle_hashes(token_hash)
    values (old.token_hash) on conflict (token_hash) do nothing;
    insert into public.revoked_session_tombstones(namespace, token_hash, pending_reservation_id)
    values ('manager_pending', old.token_hash, old.reservation_id)
    on conflict (namespace, token_hash) do nothing;
    perform public.record_manager_handoff_reconciliation(
      old.token_hash, old.reservation_id, old.manager_id, 'FAILED');
  elsif not exists (
    select 1 from public.manager_sessions s
    where s.token_hash = old.token_hash and s.expires_at > clock_timestamp()
  ) then
    perform public.record_manager_handoff_reconciliation(
      old.token_hash, old.reservation_id, old.manager_id, 'FAILED');
  end if;
  return old;
end;
$$;
revoke all on function public.tombstone_unconfirmed_manager_pending_delete()
  from public, anon, authenticated, service_role;

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
  perform public.fail_manager_handoff_reconciliation_hash(old.token_hash);
  return old;
end;
$$;
revoke all on function public.tombstone_manager_active_delete()
  from public, anon, authenticated, service_role;

-- 6. Runtime cutover. Bodies are R12-B's verbatim, plus the registry write.
--    Lock order is unchanged: restaurant parent -> manager account -> manager
--    advisory -> bearer advisory -> reservation parent -> pending child.
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
  perform public.record_manager_handoff_reconciliation(v_hash, p_reservation_id, v_account.id, 'PENDING');
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
  -- SUCCEEDED only after activation AND rate-limit consumption are both done;
  -- a later revoke/retention delete moves it forward to FAILED.
  perform public.record_manager_handoff_reconciliation(
    v_hash, p_reservation_id, v_pending.manager_id, 'SUCCEEDED');
  return true;
end;
$$;
revoke all on function public.confirm_manager_session(text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text, uuid) to service_role;

-- 7. Minimum durable-evidence read. Full registry authority (SUCCEEDED/PENDING
--    precedence, inconsistency handling) is Task 3; this only stops a
--    definitively FAILED handoff from being reported as UNKNOWN after its
--    source rows were cascaded or retained away.
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
    -- Durable exact terminal evidence survives every cascade and retention.
    if exists (select 1 from public.manager_handoff_reconciliation_registry
      where token_hash = v_hash and reservation_id = p_reservation_id
        and state = 'FAILED') then return 'FAILED'; end if;
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
commit;
