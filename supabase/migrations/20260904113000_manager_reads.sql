-- Manager-scoped reads. Both validate the bearer token and derive restaurant
-- scope from the session row (never a client-supplied id). Granted to
-- authenticated (called with the device's anon access token, like crew reads).

create or replace function public.get_manager_snapshot(p_manager_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_revision bigint;
  v_tables jsonb;
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'table_number', t.table_number,
        'status', t.status,
        'occupied_at', t.occupied_at,
        'occupied_source', t.occupied_source
      )
      order by t.table_number
    ),
    '[]'::jsonb
  ) into v_tables
  from public.table_occupancy_state t
  where t.restaurant_id = v_restaurant;

  select revision into v_revision
  from public.table_occupancy_revisions
  where restaurant_id = v_restaurant;

  return jsonb_build_object('revision', coalesce(v_revision, 0), 'tables', v_tables);
end;
$$;
revoke all on function public.get_manager_snapshot(text) from public, anon, service_role;
grant execute on function public.get_manager_snapshot(text) to authenticated;

create or replace function public.get_manager_active_crew(p_manager_token text)
returns table (role text, display_name text, checked_in_at timestamptz)
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
  select rst.role, crs.display_name, crs.checked_in_at
  from public.role_session_tokens rst
  join public.crew_role_sessions crs on crs.id = rst.role_session_id
  where rst.restaurant_id = v_restaurant
    and rst.expires_at > now()
  order by rst.role, crs.checked_in_at;
end;
$$;
revoke all on function public.get_manager_active_crew(text) from public, anon, service_role;
grant execute on function public.get_manager_active_crew(text) to authenticated;
