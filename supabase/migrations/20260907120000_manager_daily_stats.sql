-- Occupancy transitions: trigger-based audit log tracking every
-- KOSONG↔TERISI change on table_occupancy_state.
-- + RPC get_manager_daily_stats for Manager Dashboard "Statistik" tab.
-- + 90-day retention via pg_cron cleanup.

-- 1. Audit table
create table public.occupancy_transitions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  old_status text not null check (old_status in ('kosong','terisi')),
  new_status text not null check (new_status in ('kosong','terisi')),
  transitioned_at timestamptz not null default now()
);
create index occupancy_transitions_restaurant_day_idx
  on public.occupancy_transitions (restaurant_id, transitioned_at desc);
alter table public.occupancy_transitions enable row level security;
revoke all on public.occupancy_transitions from public, anon, authenticated;

-- 2. Trigger function
create or replace function public.log_occupancy_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.status is distinct from NEW.status then
    insert into public.occupancy_transitions
      (restaurant_id, table_number, old_status, new_status)
    values (NEW.restaurant_id, NEW.table_number, OLD.status, NEW.status);
  end if;
  return NEW;
end;
$$;

create trigger trg_log_occupancy_transition
  after update on public.table_occupancy_state
  for each row
  execute function public.log_occupancy_transition();

-- 3. Manager daily stats RPC
create or replace function public.get_manager_daily_stats(
  p_manager_token text,
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_day date;
  v_result jsonb;
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

  v_day := coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date);

  with day_transitions as (
    select table_number, old_status, new_status, transitioned_at
    from public.occupancy_transitions
    where restaurant_id = v_restaurant
      and (transitioned_at at time zone 'Asia/Jakarta')::date = v_day
  ),
  served as (
    select count(*) as total_served
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
  ),
  per_table as (
    select
      g.n as table_number,
      coalesce(occ.times_occupied, 0) as times_occupied,
      coalesce(dur.total_minutes, 0) as total_minutes,
      dur.avg_minutes
    from generate_series(1, 100) g(n)
    left join (
      select table_number, count(*) as times_occupied
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
    order by g.n
  )
  select jsonb_build_object(
    'total_served', (select total_served from served),
    'avg_duration_minutes', (select round(avg(minutes)::numeric, 1) from durations),
    'peak_hour', (select hr from peak),
    'per_table', (select coalesce(jsonb_agg(
      jsonb_build_object(
        'table_number', table_number,
        'times_occupied', times_occupied,
        'total_minutes', total_minutes,
        'avg_minutes', avg_minutes
      ) order by table_number
    ), '[]'::jsonb) from per_table)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_manager_daily_stats(text, date) from public, anon, service_role;
grant execute on function public.get_manager_daily_stats(text, date) to authenticated;

-- 4. Retention: 90 days
create or replace function public.cleanup_occupancy_transitions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.occupancy_transitions
  where transitioned_at < now() - interval '90 days';
end;
$$;
revoke all on function public.cleanup_occupancy_transitions() from public, anon, authenticated;
grant execute on function public.cleanup_occupancy_transitions() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (select 1 from cron.job where jobname = 'cleanup-occupancy-transitions-daily') then
    perform cron.schedule(
      'cleanup-occupancy-transitions-daily',
      '35 3 * * *',
      $cron$select public.cleanup_occupancy_transitions()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function
    or invalid_schema_name or feature_not_supported then null;
end;
$$;
