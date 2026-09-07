-- Allow valid role sessions and manager sessions to update their auth_user_id
-- on reconnect/reload when Supabase anonymous auth rotates or re-authenticates.

create or replace function public.bind_role_session_realtime(
  p_restaurant_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
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
  returning true into v_bound;

  if not coalesce(v_bound, false) then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;

create or replace function public.bind_manager_session_realtime(
  p_restaurant_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
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
  returning true into v_bound;

  if not coalesce(v_bound, false) then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
