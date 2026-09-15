-- Poin 7.1b: AM-scoped table reads. ADDITIVE ONLY — creates one bind table
-- plus 4 new service_role-only RPCs; the only touch to an existing object is
-- an added OR branch for area_manager in can_read_table_occupancy_broadcast
-- (crew + manager branches preserved verbatim).
--
-- Guests for leaderboard = occupancy_transitions kosong->terisi pairs
-- (same WIB-day semantics as get_manager_daily_stats). Table snapshots cover
-- generate_series(1,100) left-joined to sparse table_occupancy_state rows
-- (missing row = KOSONG, per the sparse-table precedent).

-- 1. AM realtime bind table (one row per AM x restaurant).
create table public.am_table_realtime_binds (
  am_id uuid not null references public.area_manager_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  auth_user_id uuid not null,
  bound_at timestamptz not null default now(),
  primary key (am_id, restaurant_id)
);
create index am_table_realtime_binds_auth_idx
  on public.am_table_realtime_binds (auth_user_id, restaurant_id);
alter table public.am_table_realtime_binds enable row level security;
revoke all on public.am_table_realtime_binds from public, anon, authenticated;
grant all on public.am_table_realtime_binds to service_role;

-- 2. Snapshot of 1 restaurant for an in-scope AM.
create or replace function public.am_table_snapshot(p_am_id uuid, p_restaurant_id uuid)
returns table (
  table_number int, status text, occupied_at timestamptz,
  occupied_source text, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.actor_can_manage_restaurant('area_manager', p_am_id, p_restaurant_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return query
    select g.n,
           coalesce(tos.status, 'kosong'),
           tos.occupied_at,
           tos.occupied_source,
           tos.updated_at
    from generate_series(1, 100) g(n)
    left join public.table_occupancy_state tos
      on tos.restaurant_id = p_restaurant_id and tos.table_number = g.n
    order by g.n;
end;
$$;
revoke all on function public.am_table_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.am_table_snapshot(uuid, uuid) to service_role;

-- 3. Daily aggregate for 1 restaurant (WIB day), mirroring get_manager_daily_stats.
create or replace function public.am_table_stats(
  p_am_id uuid,
  p_restaurant_id uuid,
  p_date date
)
returns table (
  total_served int, peak_hour int, avg_minutes numeric, per_table jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result_total int;
  v_result_peak int;
  v_result_avg numeric;
  v_result_per_table jsonb;
begin
  if not public.actor_can_manage_restaurant('area_manager', p_am_id, p_restaurant_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  with day_transitions as (
    select table_number, old_status, new_status, transitioned_at
    from public.occupancy_transitions
    where restaurant_id = p_restaurant_id
      and (transitioned_at at time zone 'Asia/Jakarta')::date = p_date
  ),
  served as (
    select count(*)::int as total_served
    from day_transitions
    where old_status = 'kosong' and new_status = 'terisi'
  ),
  peak as (
    select extract(hour from transitioned_at at time zone 'Asia/Jakarta')::int as hr
    from day_transitions
    where old_status = 'kosong' and new_status = 'terisi'
    group by hr
    order by count(*) desc
    limit 1
  ),
  paired as (
    select t_in.table_number,
           t_in.transitioned_at as occupied_at,
           (
             select min(t_out.transitioned_at)
             from day_transitions t_out
             where t_out.table_number = t_in.table_number
               and t_out.old_status = 'terisi'
               and t_out.new_status = 'kosong'
               and t_out.transitioned_at > t_in.transitioned_at
           ) as vacated_at
    from day_transitions t_in
    where t_in.old_status = 'kosong' and t_in.new_status = 'terisi'
  ),
  durations as (
    select table_number,
           extract(epoch from vacated_at - occupied_at) / 60.0 as minutes
    from paired
    where vacated_at is not null
  )
  select (select total_served from served),
         (select hr from peak),
         (select round(avg(minutes)::numeric, 1) from durations),
         (select coalesce(jsonb_agg(
            jsonb_build_object(
              'table_number', pt.table_number,
              'times_occupied', pt.times_occupied,
              'total_minutes', pt.total_minutes,
              'avg_minutes', pt.avg_minutes
            ) order by pt.table_number
          ), '[]'::jsonb)
          from (
            select g.n as table_number,
                   coalesce(occ.times_occupied, 0)::int as times_occupied,
                   coalesce(dur.total_minutes, 0)::numeric as total_minutes,
                   dur.avg_minutes
            from generate_series(1, 100) g(n)
            left join (
              select table_number, count(*)::int as times_occupied
              from day_transitions
              where old_status = 'kosong' and new_status = 'terisi'
              group by table_number
            ) occ on occ.table_number = g.n
            left join (
              select table_number,
                     round(sum(minutes)::numeric, 1) as total_minutes,
                     round(avg(minutes)::numeric, 1) as avg_minutes
              from durations
              group by table_number
            ) dur on dur.table_number = g.n
          ) pt)
  into v_result_total, v_result_peak, v_result_avg, v_result_per_table;

  return query select v_result_total, v_result_peak, v_result_avg, v_result_per_table;
end;
$$;
revoke all on function public.am_table_stats(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.am_table_stats(uuid, uuid, date) to service_role;

-- 4. Leaderboard over the caller's active AM assignments (guests desc).
create or replace function public.am_leaderboard(p_am_id uuid, p_from date, p_to date)
returns table (restaurant_id uuid, display_name text, guests int)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.display_name, coalesce(g.guests, 0)::int as guests
  from public.area_manager_assignments a
  join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
  join public.restaurants r on r.id = a.restaurant_id and r.is_active
  left join (
    select restaurant_id, count(*)::int as guests
    from public.occupancy_transitions
    where old_status = 'kosong' and new_status = 'terisi'
      and (transitioned_at at time zone 'Asia/Jakarta')::date between p_from and p_to
    group by restaurant_id
  ) g on g.restaurant_id = r.id
  where a.area_manager_id = p_am_id and a.removed_at is null
  order by guests desc, r.display_name;
$$;
revoke all on function public.am_leaderboard(uuid, date, date) from public, anon, authenticated;
grant execute on function public.am_leaderboard(uuid, date, date) to service_role;

-- 5. Bind the AM carrier JWT to a restaurant's occupancy broadcast channel.
create or replace function public.bind_am_table_realtime(p_am_id uuid, p_restaurant_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth uuid := auth.uid();
begin
  if v_auth is null then raise exception 'UNAUTHORIZED'; end if;
  if not public.actor_can_manage_restaurant('area_manager', p_am_id, p_restaurant_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  insert into public.am_table_realtime_binds (am_id, restaurant_id, auth_user_id)
  values (p_am_id, p_restaurant_id, v_auth)
  on conflict (am_id, restaurant_id)
  do update set auth_user_id = excluded.auth_user_id, bound_at = now();
  return true;
end;
$$;
revoke all on function public.bind_am_table_realtime(uuid, uuid) from public, anon, service_role;
grant execute on function public.bind_am_table_realtime(uuid, uuid) to authenticated;

-- 6. Extend the broadcast read gate with the AM branch (crew + manager
-- branches below preserved verbatim from
-- 20260904112000_manager_realtime_binding.sql).
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
  ) or exists (
    select 1
    from public.am_table_realtime_binds b
    join public.area_manager_assignments a
      on a.area_manager_id = b.am_id
      and a.restaurant_id = b.restaurant_id
      and a.removed_at is null
    join public.area_manager_accounts am on am.id = b.am_id and am.status = 'aktif'
    join public.restaurants r on r.id = b.restaurant_id and r.is_active
    where b.auth_user_id = auth.uid()
      and p_topic = 'table-occupancy:' || b.restaurant_id::text
  );
$$;
revoke all on function public.can_read_table_occupancy_broadcast(text) from public, anon, service_role;
grant execute on function public.can_read_table_occupancy_broadcast(text) to authenticated;
