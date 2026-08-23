alter table public.restaurants
  add column code_hash text,
  add column code_encrypted text,
  add column code_version integer not null default 1 check (code_version >= 1),
  add column credential_rotated_at timestamptz;

create unique index if not exists restaurants_code_hash_key
  on public.restaurants (code_hash) where code_hash is not null;

alter table public.restaurant_access_tokens add column if not exists code_version integer;
update public.restaurant_access_tokens rat
set code_version = r.code_version
from public.restaurants r
where r.id = rat.restaurant_id;
alter table public.restaurant_access_tokens alter column code_version set not null;
create index if not exists restaurant_access_tokens_version_idx
  on public.restaurant_access_tokens (restaurant_id, code_version, expires_at);

alter table public.crew_session_tokens add column if not exists code_version integer;
update public.crew_session_tokens cst
set code_version = r.code_version
from public.restaurants r
where r.id = cst.restaurant_id;
alter table public.crew_session_tokens alter column code_version set not null;
create index if not exists crew_session_tokens_version_idx
  on public.crew_session_tokens (restaurant_id, code_version, expires_at);

create table if not exists public.restaurant_credential_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  operation text not null check (operation in ('created', 'viewed', 'rotated', 'revoked', 'deactivated')),
  request_id text,
  success boolean not null,
  reason_category text,
  created_at timestamptz not null default now()
);
create index if not exists restaurant_credential_audit_created_at_idx on public.restaurant_credential_audit (created_at);
alter table public.restaurant_credential_audit enable row level security;
revoke all on public.restaurant_credential_audit from public, anon, authenticated;

create function public.cleanup_restaurant_credential_audit()
returns void language sql security definer set search_path = public as $$
  delete from public.restaurant_credential_audit where created_at < now() - interval '90 days';
$$;
revoke all on function public.cleanup_restaurant_credential_audit() from public, anon, authenticated;

drop function if exists public.claim_crew_session(uuid, text, text, text, text, boolean, text);
create function public.claim_crew_session(p_restaurant_id uuid, p_tenant_token text, p_display_name text, p_normalized_name text, p_device_description text, p_audio_ready boolean, p_visibility_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.crew_sessions; v_token text := encode(gen_random_bytes(32), 'hex'); v_code_version integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select r.code_version into v_code_version from public.restaurant_access_tokens rat join public.restaurants r on r.id = rat.restaurant_id where rat.restaurant_id = p_restaurant_id and rat.token_hash = encode(digest(p_tenant_token, 'sha256'), 'hex') and rat.expires_at > now() and r.is_active and rat.code_version = r.code_version;
  if v_code_version is null then raise exception 'INVALID_TENANT_SESSION'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40 or p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g'))) then raise exception 'INVALID_NAME'; end if;
  if p_device_description = '' or char_length(p_device_description) > 200 or p_visibility_state not in ('visible', 'hidden') then raise exception 'INVALID_SESSION'; end if;
  insert into public.crew_sessions (id, restaurant_id, normalized_name, display_name, device_description, audio_ready, visibility_state, connection_state, last_seen, offline_at) values (auth.uid(), p_restaurant_id, p_normalized_name, p_display_name, p_device_description, p_audio_ready, p_visibility_state, case when p_visibility_state = 'visible' then 'connecting' else 'disconnected' end, now(), case when p_visibility_state = 'visible' then null else now() end) on conflict (id) do update set restaurant_id = excluded.restaurant_id, normalized_name = excluded.normalized_name, display_name = excluded.display_name, device_description = excluded.device_description, audio_ready = excluded.audio_ready, visibility_state = excluded.visibility_state, connection_state = excluded.connection_state, last_seen = now(), offline_at = excluded.offline_at, updated_at = now() returning * into result;
  delete from public.crew_session_tokens where crew_session_id = result.id;
  insert into public.crew_session_tokens (token_hash, restaurant_id, crew_session_id, code_version, expires_at) values (encode(digest(v_token, 'sha256'), 'hex'), p_restaurant_id, result.id, v_code_version, now() + interval '1 hour');
  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
revoke all on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) from public, anon, service_role;
grant execute on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) to authenticated;

create function public.revoke_restaurant_credentials(p_restaurant_id uuid, p_next_code_version integer, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
  update public.crew_sessions set connection_state = 'disconnected', offline_at = now(), updated_at = now() where restaurant_id = p_restaurant_id and connection_state in ('connecting', 'connected');
  insert into public.restaurant_credential_audit (actor_id, restaurant_id, operation, success, reason_category) values (auth.uid(), p_restaurant_id, 'revoked', true, p_reason);
end;
$$;
revoke all on function public.revoke_restaurant_credentials(uuid, integer, text) from public, anon, authenticated;

create function public.provision_restaurant_credentials(p_restaurant_id uuid, p_code_hash text, p_code_encrypted text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_code_hash = '' or p_code_encrypted = '' then raise exception 'INVALID_CREDENTIAL'; end if;
  update public.restaurants
  set code_hash = p_code_hash, code_encrypted = p_code_encrypted, credential_rotated_at = now()
  where id = p_restaurant_id and code_hash is null and code_encrypted is null;
  if not found then raise exception 'RESTAURANT_NOT_PROVISIONABLE'; end if;
  insert into public.restaurant_credential_audit (restaurant_id, operation, success, reason_category)
  values (p_restaurant_id, 'created', true, 'provisioned');
end;
$$;
revoke all on function public.provision_restaurant_credentials(uuid, text, text) from public, anon, authenticated;
grant execute on function public.provision_restaurant_credentials(uuid, text, text) to service_role;
