drop index if exists public.crew_sessions_online_name_key;

revoke all on function public.create_crew_message(uuid, text, bigint) from public, anon, authenticated, service_role;
revoke all on function public.create_crew_message(uuid, text, uuid, bigint) from public, anon, authenticated, service_role;
revoke all on function public.create_remote_command(uuid, text, text) from public, anon, authenticated, service_role;

drop function if exists public.create_crew_message(uuid, text, uuid, bigint);
drop function if exists public.create_crew_message(uuid, text, bigint);
drop function if exists public.create_remote_command(uuid, text, text);
drop function if exists public.claim_crew_session(uuid, text, text, text, boolean, text);

create unique index crew_sessions_online_name_key
  on public.crew_sessions (restaurant_id, normalized_name)
  where connection_state in ('connecting', 'connected');

create function public.claim_crew_session(
  p_restaurant_id uuid,
  p_display_name text,
  p_normalized_name text,
  p_device_description text,
  p_audio_ready boolean,
  p_visibility_state text
)
returns public.crew_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40 then raise exception 'INVALID_NAME'; end if;
  if p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g'))) then raise exception 'INVALID_NAME'; end if;
  if p_device_description = '' or char_length(p_device_description) > 200 then raise exception 'INVALID_DEVICE'; end if;
  if p_visibility_state not in ('visible', 'hidden') then raise exception 'INVALID_VISIBILITY'; end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_active = true) then raise exception 'RESTAURANT_INACTIVE'; end if;

  update public.crew_sessions
  set connection_state = 'disconnected', offline_at = now(), updated_at = now()
  where restaurant_id = p_restaurant_id
    and connection_state in ('connecting', 'connected')
    and last_seen <= now() - interval '30 seconds';

  insert into public.crew_sessions (
    id, restaurant_id, normalized_name, display_name, device_description, audio_ready, visibility_state,
    connection_state, last_seen, offline_at
  ) values (
    auth.uid(), p_restaurant_id, p_normalized_name, p_display_name, p_device_description, p_audio_ready,
    p_visibility_state, case when p_visibility_state = 'visible' then 'connecting' else 'disconnected' end,
    now(), case when p_visibility_state = 'visible' then null else now() end
  ) on conflict (id) do update set
    restaurant_id = excluded.restaurant_id,
    normalized_name = excluded.normalized_name,
    display_name = excluded.display_name,
    device_description = excluded.device_description,
    audio_ready = excluded.audio_ready,
    visibility_state = excluded.visibility_state,
    connection_state = excluded.connection_state,
    last_seen = now(),
    offline_at = excluded.offline_at,
    updated_at = now()
  returning * into result;
  return result;
end;
$$;

create function public.create_remote_command(
  p_target_session_id uuid,
  p_audio_id text,
  p_actor text
)
returns public.remote_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.remote_commands;
begin
  if p_actor <> 'super-admin' or p_audio_id !~ '^(table:([1-9]|[1-6][0-9]|70)|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto))$' then raise exception 'INVALID_COMMAND'; end if;

  insert into public.remote_commands (target_session_id, restaurant_id, audio_id, actor, created_at, expires_at)
  select cs.id, cs.restaurant_id, p_audio_id, p_actor, now(), now() + interval '5 seconds'
  from public.crew_sessions cs
  where cs.id = p_target_session_id
    and cs.connection_state = 'connected'
    and cs.visibility_state = 'visible'
    and cs.audio_ready = true
    and cs.last_seen > now() - interval '30 seconds'
  returning * into result;
  if result.id is null then raise exception 'TARGET_NOT_ELIGIBLE'; end if;
  return result;
end;
$$;

create function public.create_crew_message(
  p_target_session_id uuid,
  p_message text,
  p_expires_in_seconds bigint default 5
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if char_length(p_message) > 200 then raise exception 'MESSAGE_TOO_LONG'; end if;

  insert into public.crew_messages (target_session_id, restaurant_id, message, expires_at)
  select cs.id, cs.restaurant_id, p_message, now() + make_interval(secs => p_expires_in_seconds)
  from public.crew_sessions cs
  where cs.id = p_target_session_id
  returning id into v_id;
  if v_id is null then raise exception 'TARGET_SESSION_NOT_FOUND'; end if;
  return v_id;
end;
$$;

grant execute on function public.claim_crew_session(uuid, text, text, text, boolean, text) to authenticated;
grant execute on function public.create_remote_command(uuid, text, text) to service_role;
grant execute on function public.create_crew_message(uuid, text, bigint) to service_role;
