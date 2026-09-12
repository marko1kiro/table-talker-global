-- Poin 2 review fix (C20 hardening): the realtime session-binding functions
-- treat "no row matched" as success. `returning true into v_bound` leaves
-- v_bound NULL when the UPDATE matches zero rows, and `if not v_bound` then
-- evaluates to NULL — the INVALID_SESSION guard never fires and an attacker
-- holding a stolen bearer token can bind an already-bound session to a
-- different auth identity (or bind from an unauthenticated context that
-- passes the earlier null check). Re-emit both binders with an explicit
-- `is distinct from true` guard. Forward-only; no data is touched.

create or replace function public.bind_role_session_realtime(
  p_restaurant_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_bound boolean := false;
begin
  if v_auth_user_id is null then raise exception 'UNAUTHORIZED'; end if;

  update public.role_session_tokens rst
  set auth_user_id = v_auth_user_id
  from public.restaurants r
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role in ('kasir', 'satgas', 'clear_up')
    and rst.expires_at > now()
    and r.id = rst.restaurant_id
    and r.is_active
    and rst.code_version = r.code_version
    and (rst.auth_user_id is null or rst.auth_user_id = v_auth_user_id)
  returning true into v_bound;

  if v_bound is distinct from true then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
revoke all on function public.bind_role_session_realtime(uuid, text) from public, anon, service_role;
grant execute on function public.bind_role_session_realtime(uuid, text) to authenticated;

create or replace function public.bind_manager_session_realtime(
  p_restaurant_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth uuid := auth.uid();
  v_bound boolean := false;
begin
  if v_auth is null then raise exception 'UNAUTHORIZED'; end if;
  update public.manager_sessions ms
  set auth_user_id = v_auth
  from public.manager_accounts ma, public.restaurants r
  where ms.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and ms.manager_id = ma.id
    and ma.status = 'aktif'
    and ms.restaurant_id = p_restaurant_id
    and r.id = ms.restaurant_id
    and r.is_active
    and ms.expires_at > now()
    and (ms.auth_user_id is null or ms.auth_user_id = v_auth)
  returning true into v_bound;
  if v_bound is distinct from true then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
revoke all on function public.bind_manager_session_realtime(uuid, text) from public, anon, service_role;
grant execute on function public.bind_manager_session_realtime(uuid, text) to authenticated;
