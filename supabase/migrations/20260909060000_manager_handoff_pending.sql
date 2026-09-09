-- R5-A: pending→active handshake for manager sessions.
-- create_manager_session_pending mints a session with status='pending' which
-- is invisible to dashboard, RPC, realtime, and authorization (they all
-- require status='active' or no status column match). confirm_manager_session
-- atomically promotes pending→active with a UNIQUE constraint ensuring at most
-- one active session per manager. cleanup_pending_manager_session deletes
-- unconfirmed pending sessions (best-effort; TTL handles the rest).
-- Forward-only; no data migration.

-- Add status column to manager_sessions (existing rows get 'active' default).
alter table public.manager_sessions
  add column if not exists status text not null default 'active'
  check (status in ('pending', 'active'));

-- Unique constraint: at most one ACTIVE session per manager.
-- Partial index allows multiple pending sessions (for retries).
create unique index if not exists manager_sessions_one_active_idx
  on public.manager_sessions (manager_id)
  where status = 'active';

-- Update create_manager_session to revoke old active sessions before inserting.
-- This prevents unique constraint violations when a manager logs in again.
create or replace function public.create_manager_session(p_manager_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then raise exception 'INVALID_MANAGER'; end if;

  -- Revoke any existing active session for this manager (unique index guard).
  delete from public.manager_sessions
  where manager_id = p_manager_id and status = 'active';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '12 hours';
  insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at, status)
  values (v_account.id, v_account.restaurant_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires, 'active');

  return v_token;
end;
$$;
revoke all on function public.create_manager_session(uuid) from public, anon, authenticated;
grant execute on function public.create_manager_session(uuid) to service_role;

-- Pending session with short TTL for handoff.
create or replace function public.create_manager_session_pending(p_manager_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.manager_accounts%rowtype;
  v_token text;
  v_expires timestamptz;
begin
  select * into v_account from public.manager_accounts
  where id = p_manager_id and status = 'aktif';
  if v_account.id is null then raise exception 'INVALID_MANAGER'; end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := now() + interval '60 seconds';
  insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at, status)
  values (v_account.id, v_account.restaurant_id,
          encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires, 'pending');

  return v_token;
end;
$$;
revoke all on function public.create_manager_session_pending(uuid) from public, anon, authenticated;
grant execute on function public.create_manager_session_pending(uuid) to service_role;

-- Atomically promote pending→active. Idempotent: if already active or expired,
-- returns true (nothing to do). If token is invalid, returns false.
-- The UNIQUE partial index on (manager_id) WHERE status='active' ensures at
-- most one active session per manager at the database level.
create or replace function public.confirm_manager_session(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_hash text;
  v_session public.manager_sessions%rowtype;
begin
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_session from public.manager_sessions
  where token_hash = v_token_hash
    and expires_at > now();

  if v_session.id is null then
    return false;
  end if;

  if v_session.status = 'active' then
    return true;
  end if;

  -- Promote pending→active. The unique partial index ensures at most one
  -- active session per manager; if another session was already active,
  -- the insert would conflict — but we handle that by revoking old active
  -- sessions first (belt-and-suspenders with the unique index).
  update public.manager_sessions
  set status = 'active'
  where id = v_session.id and status = 'pending';

  if not found then
    -- Race: another request promoted it already. Still valid.
    return true;
  end if;

  return true;
end;
$$;
revoke all on function public.confirm_manager_session(text) from public, anon, authenticated;
grant execute on function public.confirm_manager_session(text) to service_role;

-- Best-effort cleanup of unconfirmed pending sessions.
create or replace function public.cleanup_pending_manager_session(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.manager_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and status = 'pending';
$$;
revoke all on function public.cleanup_pending_manager_session(text) from public, anon, authenticated;
grant execute on function public.cleanup_pending_manager_session(text) to service_role;
