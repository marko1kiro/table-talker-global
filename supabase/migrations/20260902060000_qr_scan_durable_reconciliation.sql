-- M-03: make best-effort QR redirects leave a durable reconciliation trail.
-- The public route first enqueues a stable scan ID, then asks this database to
-- process it immediately. If that second call times out, pg_cron retries the
-- same ID without duplicating qr_scan_events or occupancy mutations.

create table public.pending_qr_scans (
  scan_id uuid primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'processed', 'terminal')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  terminal_at timestamptz,
  terminal_reason text
);

create index pending_qr_scans_due_idx
  on public.pending_qr_scans (next_attempt_at, created_at)
  where status = 'pending';
create index pending_qr_scans_retention_idx
  on public.pending_qr_scans (status, processed_at, terminal_at)
  where status in ('processed', 'terminal');

alter table public.pending_qr_scans enable row level security;
revoke all on table public.pending_qr_scans from public, anon, authenticated, service_role;

create or replace function public.enqueue_qr_scan(
  p_scan_id uuid,
  p_restaurant_id uuid,
  p_table_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.pending_qr_scans%rowtype;
begin
  if p_scan_id is null then raise exception 'INVALID_SCAN_ID'; end if;
  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;
  if not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id and is_active
  ) then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  insert into public.pending_qr_scans (scan_id, restaurant_id, table_number)
  values (p_scan_id, p_restaurant_id, p_table_number)
  on conflict (scan_id) do nothing;

  if not found then
    select * into v_existing
    from public.pending_qr_scans
    where scan_id = p_scan_id;

    if v_existing.restaurant_id <> p_restaurant_id
      or v_existing.table_number <> p_table_number then
      raise exception 'SCAN_ID_CONFLICT';
    end if;
  end if;
end;
$$;
revoke all on function public.enqueue_qr_scan(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_qr_scan(uuid, uuid, integer) to service_role;

create or replace function public.process_pending_qr_scan(p_scan_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.pending_qr_scans%rowtype;
  v_backoff_seconds integer;
begin
  select * into v_scan
  from public.pending_qr_scans
  where scan_id = p_scan_id
  for update;

  if not found then return false; end if;
  if v_scan.status = 'processed' then return true; end if;
  if v_scan.status = 'terminal' then return false; end if;

  update public.pending_qr_scans
  set attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      last_error = null
  where scan_id = p_scan_id;

  begin
    -- record_qr_scan retains the active-restaurant guard plus M-02's
    -- revision bump, escort resolution, and realtime broadcast behavior.
    perform public.record_qr_scan(v_scan.restaurant_id, v_scan.table_number);

    update public.pending_qr_scans
    set status = 'processed',
        processed_at = now(),
        next_attempt_at = now(),
        last_error = null
    where scan_id = p_scan_id;
    return true;
  exception
    when others then
      if sqlerrm in ('RESTAURANT_NOT_FOUND', 'INVALID_TABLE_NUMBER') then
        update public.pending_qr_scans
        set status = 'terminal',
            terminal_at = now(),
            terminal_reason = sqlerrm,
            last_error = 'SQLSTATE:' || sqlstate
        where scan_id = p_scan_id;
      else
        v_backoff_seconds := least(
          3600,
          power(2, least(v_scan.attempt_count, 11))::integer
        );
        update public.pending_qr_scans
        set status = 'pending',
            next_attempt_at = now() + make_interval(secs => v_backoff_seconds),
            last_error = 'SQLSTATE:' || sqlstate
        where scan_id = p_scan_id;
      end if;
      return false;
  end;
end;
$$;
revoke all on function public.process_pending_qr_scan(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.process_pending_qr_scan(uuid) to service_role;

create or replace function public.reconcile_pending_qr_scans(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan_id uuid;
  v_count integer := 0;
begin
  for v_scan_id in
    select scan_id
    from public.pending_qr_scans
    where status = 'pending'
      and next_attempt_at <= now()
    order by created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  loop
    perform public.process_pending_qr_scan(v_scan_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.reconcile_pending_qr_scans(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_pending_qr_scans(integer) to service_role;

create or replace function public.cleanup_pending_qr_scans()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.pending_qr_scans
  where status in ('processed', 'terminal')
    and coalesce(processed_at, terminal_at) < now() - interval '30 days';
end;
$$;
revoke all on function public.cleanup_pending_qr_scans()
  from public, anon, authenticated, service_role;
grant execute on function public.cleanup_pending_qr_scans() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (
    select 1 from cron.job
    where jobname = 'reconcile-pending-qr-scans-every-minute'
  ) then
    perform cron.schedule(
      'reconcile-pending-qr-scans-every-minute',
      '* * * * *',
      $cron$select public.reconcile_pending_qr_scans()$cron$
    );
  end if;
  if not exists (
    select 1 from cron.job
    where jobname = 'cleanup-pending-qr-scans-daily'
  ) then
    perform cron.schedule(
      'cleanup-pending-qr-scans-daily',
      '35 3 * * *',
      $cron$select public.cleanup_pending_qr_scans()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function
    or invalid_schema_name or feature_not_supported then null;
end;
$$;
