-- Fix: rename return columns to avoid ambiguous reference with table columns
-- Bug: returns table(restaurant_id uuid, ...) shadows restaurant_sessions.restaurant_id in ON CONFLICT
-- Must drop first because PostgreSQL cannot change return type of existing function via CREATE OR REPLACE
drop function if exists public.login_to_restaurant_atomic(text, text, text, text, timestamptz);

create function public.login_to_restaurant_atomic(
  p_lookup_hash text,
  p_client_bucket_hash text,
  p_ip_bucket_hash text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns table(p_rid uuid, p_rname text, p_rversion integer)
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

revoke all on function public.login_to_restaurant_atomic(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.login_to_restaurant_atomic(text, text, text, text, timestamptz) to service_role;
