-- R6-A: pending->active handshake for manager sessions, reworked from the R5
-- status-column design. STRONG TECHNICAL REASON for replacing this (still
-- unapplied) migration instead of stacking a forward-only correction:
-- the R5 design stored pending rows INSIDE manager_sessions, so every one of
-- the ~10 existing manager-token consumers (snapshot, reads, history, stats,
-- instructions, realtime bind, id-by-token, revocation) spread across 8
-- earlier migrations had to gain a "status='active'" predicate -- high
-- regression risk and easy to miss one. The pending-table design makes the
-- invariant hold BY CONSTRUCTION: manager_sessions only ever contains usable
-- (active) rows; pending handoff rows live in manager_pending_sessions and
-- are invisible to every existing consumer without touching them.
--
-- Forward-only. No data is migrated: at cutover ALL legacy manager sessions
-- are revoked (conservative fail-closed, review R6-D) — managers simply log
-- in again after the eventual migration. Master data, QR tokens/batches,
-- audio manifests and Storage are untouched.

-- 1. Cutover: revoke every legacy manager session BEFORE adding the
--    unique-active invariant (a manager may hold several legacy rows).
delete from public.manager_sessions;

-- 2. Invariant: at most ONE usable session per manager (all rows in
--    manager_sessions are active by construction now).
create unique index if not exists manager_sessions_one_active_idx
  on public.manager_sessions (manager_id);

-- 3. Pending handoff sessions: short TTL, token stored ONLY as a hash,
--    one-time confirm with a durable tombstone (confirmed_at) so a lost
--    confirm response + retry stays idempotent without duplicating rows.
create table if not exists public.manager_pending_sessions (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists manager_pending_sessions_expires_at_idx
  on public.manager_pending_sessions (expires_at);
alter table public.manager_pending_sessions enable row level security;
revoke all on public.manager_pending_sessions from public, anon, authenticated;

-- 4. Mint a PENDING session (60s TTL). The login path uses ONLY this
--    function; the legacy active-mint RPC create_manager_session is dropped
--    below so no caller can mint a usable session server-side anymore.
create or replace function public.create_manager_session_pending(p_manager_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_token text;
begin
  -- Housekeeping: purge expired/unconfirmed handoff rows (bounded growth).
  delete from public.manager_pending_sessions where expires_at < now();

  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then raise exception 'INVALID_MANAGER'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.manager_pending_sessions
    (manager_id, restaurant_id, token_hash, expires_at)
  values
    (v_account.id, v_account.restaurant_id,
     encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '60 seconds');

  return v_token;
end;
$$;
revoke all on function public.create_manager_session_pending(uuid) from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid) to service_role;

-- 5. Atomically promote pending->active (exactly once), newest-wins per
--    manager (older usable sessions of the SAME manager are revoked — never
--    another account's). When a rate-limit reservation id is supplied, the
--    login attempt's durable outcome is finalized IN THE SAME transaction
--    (R6-C): activation and accounting commit or roll back together.
--    Idempotent via the confirmed_at tombstone + the live active row, so a
--    lost response + retry returns the same verdict without duplicating.
create or replace function public.confirm_manager_session(
  p_token text,
  p_reservation_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := encode(extensions.digest(p_token, 'sha256'), 'hex');
  v_pending public.manager_pending_sessions%rowtype;
  v_consumable boolean;
begin
  -- Cheap pre-check: an already-decided reservation must not activate
  -- anything new. (The authoritative decision is re-checked under the row
  -- lock after activation, inside its own savepoint.)
  if p_reservation_id is not null then
    select consumed_at is null and expires_at > now()
    into v_consumable
    from public.owner_login_rate_limit_reservations
    where id = p_reservation_id;
    if not coalesce(v_consumable, false) then
      return false;
    end if;
  end if;

  select * into v_pending from public.manager_pending_sessions
  where token_hash = v_hash and confirmed_at is null
  for update;

  if v_pending.id is not null then
    if v_pending.expires_at <= now() then
      return false; -- expired before confirm; safety net, not authorization
    end if;

    -- Exactly-once winner takes the row (row lock above serializes racers).
    update public.manager_pending_sessions
    set confirmed_at = now()
    where id = v_pending.id and confirmed_at is null;
    if not found then
      -- A concurrent racer confirmed this pending row first; fall through
      -- to the tombstone idempotency check below.
      null;
    else
      begin
        -- Newest-wins within THIS manager only; the unique index backstops
        -- races. On violation NOTHING of this confirm is committed.
        delete from public.manager_sessions
        where manager_id = v_pending.manager_id;
        insert into public.manager_sessions
          (manager_id, restaurant_id, token_hash, expires_at)
        values
          (v_pending.manager_id, v_pending.restaurant_id, v_pending.token_hash,
           now() + interval '12 hours');
      exception when unique_violation then
        return false; -- another confirm of a DIFFERENT pending won the slot
      end;
    end if;
  end if;

  -- At this point the token's session is active (winner path) or this is a
  -- retry for an already-confirmed token (tombstone path) or nothing matched.
  -- Idempotency REQUIRES a confirmed pending tombstone: a token that was
  -- never minted as pending (born active) must not be confirmable — the
  -- handshake is the only route into the active set.
  if not exists (
    select 1 from public.manager_pending_sessions
    where token_hash = v_hash and confirmed_at is not null
  ) then
    return false;
  end if;
  if not exists (select 1 from public.manager_sessions where token_hash = v_hash) then
    return false;
  end if;

  -- R6-C: finalize the durable rate-limit outcome in the SAME transaction.
  -- apply_owner_login_rate_limit takes the reservation row FOR UPDATE itself;
  -- if the reservation is not consumable the RAISE propagates out of this
  -- function and rolls the activation back with it — activation and outcome
  -- can never diverge.
  if p_reservation_id is not null then
    if not public.apply_owner_login_rate_limit(p_reservation_id, true) then
      raise exception 'RESERVATION_NOT_CONSUMABLE' using errcode = 'R0001';
    end if;
  end if;

  return true;
end;
$$;
revoke all on function public.confirm_manager_session(text, uuid) from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text, uuid) to service_role;

-- 6. Best-effort cleanup of an UNCONFIRMED pending row (failure paths).
--    Confirmed tombstones are kept so retries stay idempotent; they expire.
create or replace function public.cleanup_pending_manager_session(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.manager_pending_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and confirmed_at is null;
$$;
revoke all on function public.cleanup_pending_manager_session(text) from public, anon, authenticated;
grant execute on function public.cleanup_pending_manager_session(text) to service_role;

-- 7. The legacy active-mint RPC must not exist anymore: a server-side minted
--    session would bypass the browser handoff entirely (review R6-A).
drop function if exists public.create_manager_session(uuid);
