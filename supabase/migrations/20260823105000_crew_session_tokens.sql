create table public.crew_session_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  crew_session_id uuid not null references public.crew_sessions (id) on delete cascade,
  expires_at timestamptz not null
);
create index crew_session_tokens_session_idx on public.crew_session_tokens (crew_session_id, expires_at);
alter table public.crew_session_tokens enable row level security;
revoke all on public.crew_session_tokens from public, anon, authenticated;

create or replace function public.claim_crew_session(p_restaurant_id uuid, p_tenant_token text, p_display_name text, p_normalized_name text, p_device_description text, p_audio_ready boolean, p_visibility_state text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.crew_sessions; v_token text := encode(gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (select 1 from public.restaurant_access_tokens rat join public.restaurants r on r.id = rat.restaurant_id where rat.restaurant_id = p_restaurant_id and rat.token_hash = encode(digest(p_tenant_token, 'sha256'), 'hex') and rat.expires_at > now() and r.is_active) then raise exception 'INVALID_TENANT_SESSION'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40 or p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g'))) then raise exception 'INVALID_NAME'; end if;
  if p_device_description = '' or char_length(p_device_description) > 200 or p_visibility_state not in ('visible', 'hidden') then raise exception 'INVALID_SESSION'; end if;
  insert into public.crew_sessions (id, restaurant_id, normalized_name, display_name, device_description, audio_ready, visibility_state, connection_state, last_seen, offline_at) values (auth.uid(), p_restaurant_id, p_normalized_name, p_display_name, p_device_description, p_audio_ready, p_visibility_state, case when p_visibility_state = 'visible' then 'connecting' else 'disconnected' end, now(), case when p_visibility_state = 'visible' then null else now() end) on conflict (id) do update set restaurant_id = excluded.restaurant_id, normalized_name = excluded.normalized_name, display_name = excluded.display_name, device_description = excluded.device_description, audio_ready = excluded.audio_ready, visibility_state = excluded.visibility_state, connection_state = excluded.connection_state, last_seen = now(), offline_at = excluded.offline_at, updated_at = now() returning * into result;
  delete from public.crew_session_tokens where crew_session_id = result.id;
  insert into public.crew_session_tokens (token_hash, restaurant_id, crew_session_id, expires_at) values (encode(digest(v_token, 'sha256'), 'hex'), p_restaurant_id, result.id, now() + interval '1 hour');
  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
revoke all on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) from public, anon, service_role;
grant execute on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) to authenticated;
