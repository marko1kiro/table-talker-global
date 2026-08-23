create table public.login_rate_limits (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  client_key_hash text not null check (client_key_hash ~ '^[a-f0-9]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  primary key (restaurant_id, client_key_hash)
);

alter table public.login_rate_limits enable row level security;
revoke all on public.login_rate_limits from public, anon, authenticated;

create function public.check_tenant_login_rate_limit(p_restaurant_id uuid, p_client_key_hash text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select blocked_until > now() from public.login_rate_limits where restaurant_id = p_restaurant_id and client_key_hash = p_client_key_hash), false)
$$;

create function public.record_tenant_login_failure(p_restaurant_id uuid, p_client_key_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.login_rate_limits (restaurant_id, client_key_hash, failures, window_started_at, blocked_until)
  values (p_restaurant_id, p_client_key_hash, 1, now(), null)
  on conflict (restaurant_id, client_key_hash) do update set
    failures = case when login_rate_limits.window_started_at <= now() - interval '15 minutes' then 1 else login_rate_limits.failures + 1 end,
    window_started_at = case when login_rate_limits.window_started_at <= now() - interval '15 minutes' then now() else login_rate_limits.window_started_at end,
    blocked_until = case when login_rate_limits.window_started_at > now() - interval '15 minutes' and login_rate_limits.failures + 1 >= 5 then now() + interval '15 minutes' else null end;
end;
$$;

create function public.clear_tenant_login_failures(p_restaurant_id uuid, p_client_key_hash text)
returns void language sql security definer set search_path = public as $$
  delete from public.login_rate_limits where restaurant_id = p_restaurant_id and client_key_hash = p_client_key_hash
$$;

create table public.operational_error_rate_limits (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  reports integer not null default 0,
  window_started_at timestamptz not null default now()
);
alter table public.operational_error_rate_limits enable row level security;
revoke all on public.operational_error_rate_limits from public, anon, authenticated;
create function public.check_operational_error_rate_limit(p_key_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_allowed boolean;
begin
  insert into public.operational_error_rate_limits (key_hash, reports) values (p_key_hash, 1)
  on conflict (key_hash) do update set reports = case when operational_error_rate_limits.window_started_at <= now() - interval '5 minutes' then 1 else operational_error_rate_limits.reports + 1 end, window_started_at = case when operational_error_rate_limits.window_started_at <= now() - interval '5 minutes' then now() else operational_error_rate_limits.window_started_at end
  returning reports <= 20 into v_allowed;
  return v_allowed;
end;
$$;
revoke all on function public.check_tenant_login_rate_limit(uuid, text), public.record_tenant_login_failure(uuid, text), public.clear_tenant_login_failures(uuid, text), public.check_operational_error_rate_limit(text) from public, anon, authenticated;
grant execute on function public.check_tenant_login_rate_limit(uuid, text), public.record_tenant_login_failure(uuid, text), public.clear_tenant_login_failures(uuid, text), public.check_operational_error_rate_limit(text) to service_role;
