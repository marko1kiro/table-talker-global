-- Let a manager subscribe to the existing private channel
-- table-occupancy:{restaurantId}. Mirrors bind_role_session_realtime; the RLS
-- SELECT policy on realtime.messages already calls can_read_table_occupancy_broadcast,
-- so only the function body is extended (crew branch preserved, manager OR-branch
-- added). No policy change needed.

create or replace function public.bind_manager_session_realtime(
  p_restaurant_id uuid,
  p_manager_token text
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
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
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

create or replace function public.can_read_table_occupancy_broadcast(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.role_session_tokens rst
    join public.restaurants r on r.id = rst.restaurant_id
    where rst.auth_user_id = auth.uid()
      and rst.role in ('kasir','satgas','clear_up')
      and rst.expires_at > now()
      and r.is_active
      and rst.code_version = r.code_version
      and p_topic = 'table-occupancy:' || rst.restaurant_id::text
  ) or exists (
    select 1
    from public.manager_sessions ms
    join public.manager_accounts ma on ma.id = ms.manager_id
    join public.restaurants r on r.id = ms.restaurant_id
    where ms.auth_user_id = auth.uid()
      and ma.status = 'aktif'
      and ms.expires_at > now()
      and r.is_active
      and p_topic = 'table-occupancy:' || ms.restaurant_id::text
  );
$$;
revoke all on function public.can_read_table_occupancy_broadcast(text) from public, anon, service_role;
grant execute on function public.can_read_table_occupancy_broadcast(text) to authenticated;
