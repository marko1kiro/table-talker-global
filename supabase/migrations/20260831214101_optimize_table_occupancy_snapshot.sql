-- Task 16: reduce Supabase egress for the role occupancy screens.
--
-- The clients already treat a missing table row as KOSONG, while Clear Up
-- only consumes TERISI rows. Preserve the RPC's public signature and auth
-- contract, but return only persisted occupied rows instead of materializing
-- all 100 table numbers on every request.
create or replace function public.get_table_occupancy_snapshot(
  p_restaurant_id uuid,
  p_session_token text
)
returns table (
  table_number integer,
  status text,
  occupied_at timestamptz,
  occupied_source text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id
    and role <> 'ss'
    and expires_at > now();
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select
    tos.table_number,
    tos.status,
    tos.occupied_at,
    tos.occupied_source
  from public.table_occupancy_state tos
  where tos.restaurant_id = p_restaurant_id
    and tos.status = 'terisi'
  order by tos.table_number;
end;
$$;

revoke all on function public.get_table_occupancy_snapshot(uuid, text) from public, anon, service_role;
grant execute on function public.get_table_occupancy_snapshot(uuid, text) to authenticated;
