create table public.tenant_global_login_rate_limits (
  bucket_hash text not null check (bucket_hash ~ '^[a-f0-9]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  primary key (bucket_hash)
);
alter table public.tenant_global_login_rate_limits enable row level security;
revoke all on public.tenant_global_login_rate_limits from public, anon, authenticated;

create function public.check_global_tenant_login_rate_limit(p_bucket_hash text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select blocked_until > now() from public.tenant_global_login_rate_limits where bucket_hash = p_bucket_hash), false)
$$;

create function public.record_global_tenant_login_failure(p_bucket_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_global_login_rate_limits (bucket_hash, failures, window_started_at, blocked_until)
  values (p_bucket_hash, 1, now(), null)
  on conflict (bucket_hash) do update set
    failures = case when tenant_global_login_rate_limits.window_started_at <= now() - interval '15 minutes' then 1 else tenant_global_login_rate_limits.failures + 1 end,
    window_started_at = case when tenant_global_login_rate_limits.window_started_at <= now() - interval '15 minutes' then now() else tenant_global_login_rate_limits.window_started_at end,
    blocked_until = case when tenant_global_login_rate_limits.window_started_at > now() - interval '15 minutes' and tenant_global_login_rate_limits.failures + 1 >= 5 then now() + interval '15 minutes' else null end;
end;
$$;

create function public.clear_global_tenant_login_failures(p_bucket_hash text)
returns void language sql security definer set search_path = public as $$
  delete from public.tenant_global_login_rate_limits where bucket_hash = p_bucket_hash
$$;

revoke all on function public.check_global_tenant_login_rate_limit(text), public.record_global_tenant_login_failure(text), public.clear_global_tenant_login_failures(text) from public, anon, authenticated;
grant execute on function public.check_global_tenant_login_rate_limit(text), public.record_global_tenant_login_failure(text), public.clear_global_tenant_login_failures(text) to service_role;
