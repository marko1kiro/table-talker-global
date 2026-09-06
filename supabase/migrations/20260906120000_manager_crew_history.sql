-- Manager read: riwayat check-in crew per tanggal WIB (atau terbatas terbaru
-- saat p_date null), plus flag is_active dari role_session_tokens yang masih
-- berlaku. Sumber: crew_role_sessions (audit log insert-only).
create or replace function public.get_manager_crew_history(
  p_manager_token text,
  p_date date default null
)
returns table (role text, display_name text, checked_in_at timestamptz, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
begin
  select ms.restaurant_id into v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select crs.role,
         crs.display_name,
         crs.checked_in_at,
         exists (
           select 1 from public.role_session_tokens rst
           where rst.role_session_id = crs.id and rst.expires_at > now()
         )
  from public.crew_role_sessions crs
  where crs.restaurant_id = v_restaurant
    and (p_date is null or (crs.checked_in_at at time zone 'Asia/Jakarta')::date = p_date)
  order by crs.checked_in_at desc
  limit (case when p_date is null then 300 else 500 end);
end;
$$;
revoke all on function public.get_manager_crew_history(text, date) from public, anon, service_role;
grant execute on function public.get_manager_crew_history(text, date) to authenticated;

-- Terpenuhkan penuh oleh get_manager_crew_history.
drop function if exists public.get_manager_active_crew(text);
