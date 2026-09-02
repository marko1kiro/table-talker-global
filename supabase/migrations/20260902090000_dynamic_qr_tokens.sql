-- M-01: opaque, selectively replaceable QR tokens with permanent export history.
-- Export objects are uploaded before commit_qr_export_batch is called, so a
-- storage failure cannot revoke a physical QR that is still in use.

create table public.qr_export_batches (
  id uuid primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by text not null check (char_length(created_by) between 1 and 120),
  domain_used text not null check (domain_used ~ '^https?://'),
  scope text not null check (scope in ('all', 'selected')),
  table_numbers integer[] not null check (cardinality(table_numbers) between 1 and 100),
  r2_key_xlsx text not null,
  r2_key_csv text not null
);

create index qr_export_batches_restaurant_created_idx
  on public.qr_export_batches (restaurant_id, created_at desc);

create table public.qr_table_tokens (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{43}$'),
  batch_id uuid not null references public.qr_export_batches (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index qr_table_tokens_token_idx on public.qr_table_tokens (token);
create index qr_table_tokens_batch_idx on public.qr_table_tokens (batch_id);
create unique index qr_table_tokens_one_active_per_table_idx
  on public.qr_table_tokens (restaurant_id, table_number)
  where revoked_at is null;

-- Only a one-day rolling debounce window is retained. Raw IP addresses are
-- never stored: the application supplies a SHA-256 hash.
create table public.qr_scan_debounce (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  last_scan_at timestamptz not null default now(),
  window_started_at timestamptz not null default now(),
  accepted_scan_count integer not null default 1 check (accepted_scan_count between 1 and 10),
  primary key (restaurant_id, table_number, ip_hash)
);

alter table public.qr_export_batches enable row level security;
alter table public.qr_table_tokens enable row level security;
alter table public.qr_scan_debounce enable row level security;

revoke all on table public.qr_export_batches from public, anon, authenticated;
revoke all on table public.qr_table_tokens from public, anon, authenticated;
revoke all on table public.qr_scan_debounce from public, anon, authenticated;
grant all on table public.qr_export_batches to service_role;
grant all on table public.qr_table_tokens to service_role;
grant all on table public.qr_scan_debounce to service_role;

create or replace function public.commit_qr_export_batch(
  p_batch_id uuid,
  p_restaurant_id uuid,
  p_created_by text,
  p_domain_used text,
  p_scope text,
  p_table_numbers integer[],
  p_tokens text[],
  p_r2_key_xlsx text,
  p_r2_key_csv text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_scope not in ('all', 'selected')
     or p_created_by is null or char_length(p_created_by) not between 1 and 120
     or p_domain_used !~ '^https?://'
     or coalesce(cardinality(p_table_numbers), 0) not between 1 and 100
     or cardinality(p_tokens) <> cardinality(p_table_numbers)
     or p_r2_key_xlsx is null or p_r2_key_csv is null then
    raise exception 'INVALID_QR_BATCH';
  end if;

  select count(*) into v_count
  from (select distinct n from unnest(p_table_numbers) n where n between 1 and 100) valid;
  if v_count <> cardinality(p_table_numbers)
     or exists (select 1 from unnest(p_tokens) t where t !~ '^[A-Za-z0-9_-]{43}$') then
    raise exception 'INVALID_QR_BATCH';
  end if;

  if not exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.is_active
  ) then
    raise exception 'RESTAURANT_NOT_ACTIVE';
  end if;

  insert into public.qr_export_batches (
    id, restaurant_id, created_by, domain_used, scope, table_numbers,
    r2_key_xlsx, r2_key_csv
  ) values (
    p_batch_id, p_restaurant_id, p_created_by, p_domain_used, p_scope,
    p_table_numbers, p_r2_key_xlsx, p_r2_key_csv
  );

  update public.qr_table_tokens
  set revoked_at = now()
  where restaurant_id = p_restaurant_id
    and table_number = any(p_table_numbers)
    and revoked_at is null;

  insert into public.qr_table_tokens (
    restaurant_id, table_number, token, batch_id
  )
  select p_restaurant_id, selected.table_number, selected.token, p_batch_id
  from unnest(p_table_numbers, p_tokens) as selected(table_number, token);
end;
$$;

create or replace function public.resolve_and_enqueue_qr_scan(
  p_scan_id uuid,
  p_token text,
  p_ip_hash text
)
returns table (
  restaurant_id uuid,
  table_number integer,
  esb_app_id text,
  enqueued boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant_id uuid;
  v_table_number integer;
  v_esb_app_id text;
  v_enqueued boolean := false;
begin
  if p_token !~ '^[A-Za-z0-9_-]{43}$' or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select t.restaurant_id, t.table_number, r.esb_app_id
  into v_restaurant_id, v_table_number, v_esb_app_id
  from public.qr_table_tokens t
  join public.restaurants r on r.id = t.restaurant_id
  where t.token = p_token
    and t.revoked_at is null
    and r.is_active
    and nullif(btrim(r.esb_app_id), '') is not null;

  if not found then return; end if;

  insert into public.qr_scan_debounce as debounce (
    restaurant_id, table_number, ip_hash, last_scan_at, window_started_at, accepted_scan_count
  ) values (
    v_restaurant_id, v_table_number, p_ip_hash, now(), now(), 1
  )
  on conflict (restaurant_id, table_number, ip_hash) do update
    set last_scan_at = now(),
        window_started_at = case
          when debounce.window_started_at <= now() - interval '10 minutes' then now()
          else debounce.window_started_at
        end,
        accepted_scan_count = case
          when debounce.window_started_at <= now() - interval '10 minutes' then 1
          else debounce.accepted_scan_count + 1
        end
    where debounce.last_scan_at <= now() - interval '30 seconds'
      and (
        debounce.window_started_at <= now() - interval '10 minutes'
        or debounce.accepted_scan_count < 10
      )
  returning true into v_enqueued;

  if coalesce(v_enqueued, false) then
    insert into public.pending_qr_scans (scan_id, restaurant_id, table_number)
    values (p_scan_id, v_restaurant_id, v_table_number)
    on conflict (scan_id) do nothing;
  end if;

  return query select v_restaurant_id, v_table_number, v_esb_app_id, coalesce(v_enqueued, false);
end;
$$;

create or replace function public.list_qr_export_batches(p_restaurant_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  created_by text,
  domain_used text,
  scope text,
  table_numbers integer[],
  r2_key_xlsx text,
  r2_key_csv text,
  status text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    b.id,
    b.created_at,
    b.created_by,
    b.domain_used,
    b.scope,
    b.table_numbers,
    b.r2_key_xlsx,
    b.r2_key_csv,
    case
      when active_tokens.count = cardinality(b.table_numbers) then 'ACTIVE'
      when active_tokens.count = 0 then 'EXPIRED'
      else 'SEBAGIAN AKTIF'
    end as status
  from public.qr_export_batches b
  cross join lateral (
    select count(*)::integer as count
    from public.qr_table_tokens t
    where t.batch_id = b.id and t.revoked_at is null
  ) active_tokens
  where b.restaurant_id = p_restaurant_id
  order by b.created_at desc;
$$;

create or replace function public.get_qr_export_key(
  p_batch_id uuid,
  p_format text
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case p_format
    when 'xlsx' then b.r2_key_xlsx
    when 'csv' then b.r2_key_csv
  end
  from public.qr_export_batches b
  where b.id = p_batch_id and p_format in ('xlsx', 'csv');
$$;

create or replace function public.cleanup_qr_scan_debounce()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.qr_scan_debounce
  where last_scan_at < now() - interval '1 day';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text) from public, anon, authenticated;
revoke all on function public.resolve_and_enqueue_qr_scan(uuid, text, text) from public, anon, authenticated;
revoke all on function public.list_qr_export_batches(uuid) from public, anon, authenticated;
revoke all on function public.get_qr_export_key(uuid, text) from public, anon, authenticated;
revoke all on function public.cleanup_qr_scan_debounce() from public, anon, authenticated;
grant execute on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text) to service_role;
grant execute on function public.resolve_and_enqueue_qr_scan(uuid, text, text) to service_role;
grant execute on function public.list_qr_export_batches(uuid) to service_role;
grant execute on function public.get_qr_export_key(uuid, text) to service_role;
grant execute on function public.cleanup_qr_scan_debounce() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'cleanup-qr-scan-debounce';

    perform cron.schedule(
      'cleanup-qr-scan-debounce',
      '23 3 * * *',
      'select public.cleanup_qr_scan_debounce();'
    );
  end if;
end;
$$;
