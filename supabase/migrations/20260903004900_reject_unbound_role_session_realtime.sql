-- L-01 remediation: PL/pgSQL sets a DML RETURNING target to NULL when the
-- update affects zero rows. Treat that NULL as a failed role-session bind.

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

  if not coalesce(v_bound, false) then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
revoke all on function public.bind_role_session_realtime(uuid, text) from public, anon, service_role;
grant execute on function public.bind_role_session_realtime(uuid, text) to authenticated;
