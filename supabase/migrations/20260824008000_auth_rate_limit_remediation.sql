create table public.owner_login_rate_limit_buckets (
  bucket_hash text primary key check (bucket_hash ~ '^[a-f0-9]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  sequence bigint not null default 0 check (sequence >= 0),
  last_success_sequence bigint not null default 0 check (last_success_sequence >= 0 and last_success_sequence <= sequence)
);
alter table public.owner_login_rate_limit_buckets enable row level security;
revoke all on public.owner_login_rate_limit_buckets from public, anon, authenticated;

create table public.owner_login_rate_limit_reservations (
  id uuid primary key default extensions.gen_random_uuid(),
  client_bucket_hash text not null references public.owner_login_rate_limit_buckets(bucket_hash) on delete cascade check (client_bucket_hash ~ '^[a-f0-9]{64}$'),
  ip_bucket_hash text not null references public.owner_login_rate_limit_buckets(bucket_hash) on delete cascade check (ip_bucket_hash ~ '^[a-f0-9]{64}$'),
  client_sequence bigint not null,
  ip_sequence bigint not null,
  expires_at timestamptz not null default (now() + interval '60 seconds'),
  consumed_at timestamptz
);
alter table public.owner_login_rate_limit_reservations enable row level security;
revoke all on public.owner_login_rate_limit_reservations from public, anon, authenticated;
create index owner_login_rate_limit_reservations_expires_at_idx on public.owner_login_rate_limit_reservations(expires_at);
create index owner_login_rate_limit_reservations_consumed_at_idx on public.owner_login_rate_limit_reservations(consumed_at);

create function public.reserve_owner_login_attempt(p_client_bucket_hash text, p_ip_bucket_hash text)
returns table(reservation_id uuid) language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_client public.owner_login_rate_limit_buckets%rowtype; v_ip public.owner_login_rate_limit_buckets%rowtype; v_id uuid;
begin
  if p_client_bucket_hash !~ '^[a-f0-9]{64}$' or p_ip_bucket_hash !~ '^[a-f0-9]{64}$' then return; end if;
  insert into public.owner_login_rate_limit_buckets(bucket_hash)
  select distinct bucket_hash from unnest(array[p_client_bucket_hash, p_ip_bucket_hash]) bucket_hash order by bucket_hash
  on conflict (bucket_hash) do nothing;
  perform 1 from public.owner_login_rate_limit_buckets where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash) order by bucket_hash for update;
  select * into v_client from public.owner_login_rate_limit_buckets where bucket_hash = p_client_bucket_hash;
  select * into v_ip from public.owner_login_rate_limit_buckets where bucket_hash = p_ip_bucket_hash;
  if v_client.blocked_until > now() or v_ip.blocked_until > now() then return; end if;
  update public.owner_login_rate_limit_buckets set sequence = sequence + 1
  where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
  select * into v_client from public.owner_login_rate_limit_buckets where bucket_hash = p_client_bucket_hash;
  select * into v_ip from public.owner_login_rate_limit_buckets where bucket_hash = p_ip_bucket_hash;
  insert into public.owner_login_rate_limit_reservations(client_bucket_hash, ip_bucket_hash, client_sequence, ip_sequence)
  values (p_client_bucket_hash, p_ip_bucket_hash, v_client.sequence, v_ip.sequence) returning id into v_id;
  return query select v_id;
end;
$$;

create function public.complete_owner_login_attempt(p_reservation_id uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_reservation public.owner_login_rate_limit_reservations%rowtype; v_now timestamptz := now();
begin
  select * into v_reservation from public.owner_login_rate_limit_reservations where id = p_reservation_id and consumed_at is null and expires_at > v_now for update;
  if not found then return false; end if;
  perform 1 from public.owner_login_rate_limit_buckets
  where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash)
  order by bucket_hash for update;
  update public.owner_login_rate_limit_reservations set consumed_at = v_now where id = p_reservation_id;
  if p_success then
    update public.owner_login_rate_limit_buckets set
      last_success_sequence = greatest(last_success_sequence, case when bucket_hash = v_reservation.client_bucket_hash then v_reservation.client_sequence else v_reservation.ip_sequence end)
    where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash);
    update public.owner_login_rate_limit_buckets set
      failures = 0,
      window_started_at = v_now,
      blocked_until = null
    where (bucket_hash = v_reservation.client_bucket_hash and v_reservation.client_sequence = sequence)
       or (bucket_hash = v_reservation.ip_bucket_hash and v_reservation.ip_sequence = sequence);
  else
    update public.owner_login_rate_limit_buckets set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes' else blocked_until end
    where (bucket_hash = v_reservation.client_bucket_hash and v_reservation.client_sequence > last_success_sequence)
       or (bucket_hash = v_reservation.ip_bucket_hash and v_reservation.ip_sequence > last_success_sequence);
  end if;
  return true;
end;
$$;

create function public.cleanup_owner_login_rate_limits()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare reservations_deleted integer; buckets_deleted integer;
begin
  delete from public.owner_login_rate_limit_reservations
  where consumed_at < now() - interval '1 day' or expires_at < now() - interval '1 day';
  get diagnostics reservations_deleted = row_count;
  delete from public.owner_login_rate_limit_buckets b
  where b.window_started_at < now() - interval '1 day'
    and not exists (
      select 1 from public.owner_login_rate_limit_reservations r
      where r.client_bucket_hash = b.bucket_hash or r.ip_bucket_hash = b.bucket_hash
    );
  get diagnostics buckets_deleted = row_count;
  return jsonb_build_object('reservations_deleted', reservations_deleted, 'buckets_deleted', buckets_deleted);
end;
$$;

create or replace function public.login_to_restaurant_atomic(
  p_lookup_hash text,
  p_client_bucket_hash text,
  p_ip_bucket_hash text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(restaurant_id uuid, display_name text, code_version integer)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_now timestamptz := now();
  v_restaurant public.restaurants%rowtype;
begin
  if p_lookup_hash is null
    or p_client_bucket_hash is null
    or p_ip_bucket_hash is null
    or p_token_hash is null
    or p_expires_at is null
    or p_lookup_hash !~ '^hmac-sha256:v1:[A-Za-z0-9_-]{43}$'
    or p_client_bucket_hash !~ '^[a-f0-9]{64}$'
    or p_ip_bucket_hash !~ '^[a-f0-9]{64}$'
    or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_expires_at <= v_now
    or p_expires_at > v_now + interval '1 hour' + interval '5 minutes' then
    raise exception 'INVALID_LOGIN_INPUT';
  end if;

  insert into public.tenant_global_login_rate_limits(bucket_hash)
  select distinct bucket_hash
  from unnest(array[p_client_bucket_hash, p_ip_bucket_hash]) bucket_hash
  order by bucket_hash
  on conflict (bucket_hash) do nothing;
  insert into public.tenant_login_rate_limits(lookup_hash, bucket_hash)
  select p_lookup_hash, bucket_hash
  from unnest(array[p_client_bucket_hash, p_ip_bucket_hash]) bucket_hash
  group by bucket_hash
  order by bucket_hash
  on conflict (lookup_hash, bucket_hash) do nothing;

  perform 1 from public.tenant_global_login_rate_limits
  where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash)
  order by bucket_hash for update;
  perform 1 from public.tenant_login_rate_limits
  where lookup_hash = p_lookup_hash and bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash)
  order by lookup_hash, bucket_hash for update;

  if exists (
    select 1 from public.tenant_global_login_rate_limits
    where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash) and blocked_until > v_now
  ) or exists (
    select 1 from public.tenant_login_rate_limits
    where lookup_hash = p_lookup_hash and bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash) and blocked_until > v_now
  ) then
    return;
  end if;

  select * into v_restaurant from public.restaurants
  where code_hash = p_lookup_hash and is_active
  for key share;
  if not found then
    update public.tenant_global_login_rate_limits set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes' else null end
    where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
    update public.tenant_login_rate_limits set
      failures = case when window_started_at <= v_now - interval '15 minutes' then 1 else failures + 1 end,
      window_started_at = case when window_started_at <= v_now - interval '15 minutes' then v_now else window_started_at end,
      blocked_until = case when window_started_at > v_now - interval '15 minutes' and failures + 1 >= 5 then v_now + interval '15 minutes' else null end
    where lookup_hash = p_lookup_hash and bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
    return;
  end if;

  delete from public.tenant_global_login_rate_limits
  where bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
  delete from public.tenant_login_rate_limits
  where lookup_hash = p_lookup_hash and bucket_hash in (p_client_bucket_hash, p_ip_bucket_hash);
  insert into public.restaurant_sessions(restaurant_id, session_date)
  values (v_restaurant.id, current_date)
  on conflict (restaurant_id, session_date) do update
  set restaurant_id = excluded.restaurant_id;
  insert into public.restaurant_access_tokens(token_hash, restaurant_id, code_version, expires_at)
  values (p_token_hash, v_restaurant.id, v_restaurant.code_version, p_expires_at);
  return query select v_restaurant.id, v_restaurant.display_name, v_restaurant.code_version;
end;
$$;

create or replace function public.run_owner_retention()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb; login_limits jsonb; tenant_login_limits jsonb;
begin
  result := public.cleanup_owner_retention();
  login_limits := public.cleanup_owner_login_rate_limits();
  tenant_login_limits := public.cleanup_tenant_login_rate_limits();
  result := result || jsonb_build_object('owner_login_rate_limits', login_limits, 'tenant_login_rate_limits', tenant_login_limits);
  perform public.record_owner_retention_success(result);
  return result;
end;
$$;

create or replace function public.cleanup_tenant_login_rate_limits()
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare lookup_deleted integer; global_deleted integer;
begin
  delete from public.tenant_login_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics lookup_deleted = row_count;
  delete from public.tenant_global_login_rate_limits where window_started_at < now() - interval '1 day';
  get diagnostics global_deleted = row_count;
  return jsonb_build_object('lookup_deleted', lookup_deleted, 'global_deleted', global_deleted);
end;
$$;

revoke all on function public.reserve_owner_login_attempt(text, text), public.complete_owner_login_attempt(uuid, boolean), public.cleanup_owner_login_rate_limits(), public.cleanup_tenant_login_rate_limits(), public.login_to_restaurant_atomic(text, text, text, text, timestamptz), public.run_owner_retention() from public, anon, authenticated;
revoke all on function public.check_tenant_login_rate_limit(uuid, text), public.record_tenant_login_failure(uuid, text), public.clear_tenant_login_failures(uuid, text), public.check_tenant_login_rate_limit(text, text), public.record_tenant_login_failure(text, text), public.clear_tenant_login_failures(text, text), public.check_global_tenant_login_rate_limit(text), public.record_global_tenant_login_failure(text), public.clear_global_tenant_login_failures(text) from public, anon, authenticated, service_role;
grant execute on function public.reserve_owner_login_attempt(text, text) to service_role;
grant execute on function public.complete_owner_login_attempt(uuid, boolean) to service_role;
grant execute on function public.cleanup_owner_login_rate_limits(), public.cleanup_tenant_login_rate_limits(), public.run_owner_retention() to service_role;
grant execute on function public.login_to_restaurant_atomic(text, text, text, text, timestamptz) to service_role;

drop function if exists public.check_tenant_login_rate_limit(uuid, text);
drop function if exists public.record_tenant_login_failure(uuid, text);
drop function if exists public.clear_tenant_login_failures(uuid, text);
drop function if exists public.check_tenant_login_rate_limit(text, text);
drop function if exists public.record_tenant_login_failure(text, text);
drop function if exists public.clear_tenant_login_failures(text, text);
drop function if exists public.check_global_tenant_login_rate_limit(text);
drop function if exists public.record_global_tenant_login_failure(text);
drop function if exists public.clear_global_tenant_login_failures(text);
