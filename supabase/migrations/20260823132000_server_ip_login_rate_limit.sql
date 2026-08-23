alter table public.tenant_login_rate_limits rename column client_key_hash to bucket_hash;

drop function public.check_tenant_login_rate_limit(text, text);
drop function public.record_tenant_login_failure(text, text);
drop function public.clear_tenant_login_failures(text, text);

create function public.check_tenant_login_rate_limit(p_lookup_hash text, p_bucket_hash text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select blocked_until > now() from public.tenant_login_rate_limits where lookup_hash = p_lookup_hash and bucket_hash = p_bucket_hash), false)
$$;

create function public.record_tenant_login_failure(p_lookup_hash text, p_bucket_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_login_rate_limits (lookup_hash, bucket_hash, failures, window_started_at, blocked_until)
  values (p_lookup_hash, p_bucket_hash, 1, now(), null)
  on conflict (lookup_hash, bucket_hash) do update set
    failures = case when tenant_login_rate_limits.window_started_at <= now() - interval '15 minutes' then 1 else tenant_login_rate_limits.failures + 1 end,
    window_started_at = case when tenant_login_rate_limits.window_started_at <= now() - interval '15 minutes' then now() else tenant_login_rate_limits.window_started_at end,
    blocked_until = case when tenant_login_rate_limits.window_started_at > now() - interval '15 minutes' and tenant_login_rate_limits.failures + 1 >= 5 then now() + interval '15 minutes' else null end;
end;
$$;

create function public.clear_tenant_login_failures(p_lookup_hash text, p_bucket_hash text)
returns void language sql security definer set search_path = public as $$
  delete from public.tenant_login_rate_limits where lookup_hash = p_lookup_hash and bucket_hash = p_bucket_hash
$$;

revoke all on function public.check_tenant_login_rate_limit(text, text), public.record_tenant_login_failure(text, text), public.clear_tenant_login_failures(text, text) from public, anon, authenticated;
grant execute on function public.check_tenant_login_rate_limit(text, text), public.record_tenant_login_failure(text, text), public.clear_tenant_login_failures(text, text) to service_role;
