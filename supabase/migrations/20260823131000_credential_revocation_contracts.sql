create extension if not exists pgcrypto with schema extensions;

create table public.tenant_login_rate_limits (
  lookup_hash text not null,
  client_key_hash text not null check (client_key_hash ~ '^[a-f0-9]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  primary key (lookup_hash, client_key_hash)
);
alter table public.tenant_login_rate_limits enable row level security;
revoke all on public.tenant_login_rate_limits from public, anon, authenticated;

create function public.check_tenant_login_rate_limit(p_lookup_hash text, p_client_key_hash text)
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select blocked_until > now() from public.tenant_login_rate_limits where lookup_hash = p_lookup_hash and client_key_hash = p_client_key_hash), false)
$$;

create function public.record_tenant_login_failure(p_lookup_hash text, p_client_key_hash text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tenant_login_rate_limits (lookup_hash, client_key_hash, failures, window_started_at, blocked_until)
  values (p_lookup_hash, p_client_key_hash, 1, now(), null)
  on conflict (lookup_hash, client_key_hash) do update set
    failures = case when tenant_login_rate_limits.window_started_at <= now() - interval '15 minutes' then 1 else tenant_login_rate_limits.failures + 1 end,
    window_started_at = case when tenant_login_rate_limits.window_started_at <= now() - interval '15 minutes' then now() else tenant_login_rate_limits.window_started_at end,
    blocked_until = case when tenant_login_rate_limits.window_started_at > now() - interval '15 minutes' and tenant_login_rate_limits.failures + 1 >= 5 then now() + interval '15 minutes' else null end;
end;
$$;

create function public.clear_tenant_login_failures(p_lookup_hash text, p_client_key_hash text)
returns void language sql security definer set search_path = public as $$
  delete from public.tenant_login_rate_limits where lookup_hash = p_lookup_hash and client_key_hash = p_client_key_hash
$$;

drop function public.heartbeat_crew_session(boolean, text, text);
create function public.heartbeat_crew_session(p_audio_ready boolean, p_visibility_state text, p_connection_state text, p_session_token text)
returns public.crew_sessions language plpgsql security definer set search_path = public as $$
declare result public.crew_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.crew_session_tokens cst join public.restaurants r on r.id = cst.restaurant_id join public.crew_sessions cs on cs.id = cst.crew_session_id where cst.crew_session_id = auth.uid() and cst.token_hash = encode(extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'), 'hex') and cst.expires_at > now() and cst.code_version = r.code_version and r.is_active and cs.restaurant_id = r.id) then raise exception 'INVALID_CREW_SESSION'; end if;
  if p_visibility_state not in ('visible', 'hidden') or p_connection_state not in ('connected', 'disconnected') then raise exception 'INVALID_PRESENCE'; end if;
  update public.crew_sessions set audio_ready = p_audio_ready, visibility_state = p_visibility_state, connection_state = case when p_visibility_state = 'visible' then p_connection_state else 'disconnected' end, last_seen = now(), offline_at = case when p_visibility_state = 'visible' and p_connection_state = 'connected' then null else now() end, updated_at = now() where id = auth.uid() returning * into result;
  if result.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  return result;
end;
$$;

drop function public.claim_pending_remote_command();
create function public.claim_pending_remote_command(p_session_token text)
returns public.remote_commands language sql stable security definer set search_path = public as $$
  select command from public.remote_commands command
  where command.target_session_id = auth.uid() and command.status = 'sent' and command.expires_at > now()
    and exists (select 1 from public.crew_session_tokens cst join public.restaurants r on r.id = cst.restaurant_id join public.crew_sessions cs on cs.id = cst.crew_session_id where cst.crew_session_id = auth.uid() and cst.token_hash = encode(extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'), 'hex') and cst.expires_at > now() and cst.code_version = r.code_version and r.is_active and cs.restaurant_id = r.id)
  order by command.created_at desc, command.id desc limit 1;
$$;

drop function public.ack_remote_command(uuid, text, text);
create function public.ack_remote_command(p_command_id uuid, p_status text, p_failure_reason text, p_session_token text)
returns public.remote_commands language plpgsql security definer set search_path = public as $$
declare result public.remote_commands;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.crew_session_tokens cst join public.restaurants r on r.id = cst.restaurant_id join public.crew_sessions cs on cs.id = cst.crew_session_id where cst.crew_session_id = auth.uid() and cst.token_hash = encode(extensions.digest(convert_to(p_session_token, 'UTF8'), 'sha256'), 'hex') and cst.expires_at > now() and cst.code_version = r.code_version and r.is_active and cs.restaurant_id = r.id) then raise exception 'INVALID_CREW_SESSION'; end if;
  if p_status not in ('played', 'failed') then raise exception 'INVALID_STATUS'; end if;
  update public.remote_commands set status = p_status, acknowledged_at = now(), failure_reason = case when p_status = 'failed' then left(coalesce(nullif(p_failure_reason, ''), 'Pemutaran audio gagal.'), 160) else null end where id = p_command_id and target_session_id = auth.uid() and status = 'sent' and expires_at > now() returning * into result;
  if result.id is null then raise exception 'COMMAND_NOT_ACKNOWLEDGEABLE'; end if;
  return result;
end;
$$;

revoke all on function public.heartbeat_crew_session(boolean, text, text, text), public.claim_pending_remote_command(text), public.ack_remote_command(uuid, text, text, text) from public, anon;
grant execute on function public.heartbeat_crew_session(boolean, text, text, text), public.claim_pending_remote_command(text), public.ack_remote_command(uuid, text, text, text) to authenticated;
grant execute on function public.rotate_restaurant_credentials(uuid, text, text, integer), public.deactivate_restaurant_credentials(uuid, integer) to service_role;
revoke all on function public.check_tenant_login_rate_limit(text, text), public.record_tenant_login_failure(text, text), public.clear_tenant_login_failures(text, text) from public, anon, authenticated;
grant execute on function public.check_tenant_login_rate_limit(text, text), public.record_tenant_login_failure(text, text), public.clear_tenant_login_failures(text, text) to service_role;
