-- R3-A (round 3 review): server-authoritative revocation of a SINGLE bearer
-- session by its raw token. Used by role switches and logout so a stolen or
-- replaced credential dies in the database, not only in the browser.
--
-- Trust model: the raw bearer token is its own revocation proof (exactly like
-- a logout endpoint) — whoever presents it can end that one session. Scope is
-- a single row: devices/sessions of the same account elsewhere are untouched
-- (use revoke_staff_sessions / revoke_manager_sessions for account-wide
-- revocation, which lifecycle events already do).
--
-- Both functions are idempotent (false when nothing matched) and service_role
-- only, like every other Poin 2 function. Forward-only, after 20260909040000;
-- the whole Poin 2 chain is still unapplied remotely.

create or replace function public.revoke_staff_session_by_token(p_kind text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_kind not in ('super_admin', 'area_manager') then
    return false;
  end if;
  delete from public.staff_sessions
  where session_kind = p_kind
    and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
revoke all on function public.revoke_staff_session_by_token(text, text) from public, anon, authenticated;
grant execute on function public.revoke_staff_session_by_token(text, text) to service_role;

create or replace function public.revoke_manager_session_by_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.manager_sessions
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;
revoke all on function public.revoke_manager_session_by_token(text) from public, anon, authenticated;
grant execute on function public.revoke_manager_session_by_token(text) to service_role;
