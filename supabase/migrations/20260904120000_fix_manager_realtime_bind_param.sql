-- Fix: the shared realtime hook (use-table-occupancy-realtime.ts) always sends
-- the bearer as `p_session_token` (matching bind_role_session_realtime). The
-- manager bind rpc was created with a differently-named token param, so the
-- PostgREST call failed to bind -> the private channel never reached SUBSCRIBED
-- -> the manager dashboard showed a permanent "Menunggu koneksi realtime"
-- banner. Redefine the function with the `p_session_token` param name; logic is
-- unchanged.

-- Postgres cannot rename an input parameter via CREATE OR REPLACE (42P13), so
-- drop the old-signature function first.
drop function if exists public.bind_manager_session_realtime(uuid, text);

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
  if not v_bound then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
revoke all on function public.bind_manager_session_realtime(uuid, text) from public, anon, service_role;
grant execute on function public.bind_manager_session_realtime(uuid, text) to authenticated;
