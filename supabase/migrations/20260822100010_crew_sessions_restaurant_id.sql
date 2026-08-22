-- Add restaurant_id to crew_sessions
alter table public.crew_sessions
  add column restaurant_id uuid;

-- Backfill pilot tenant
update public.crew_sessions
  set restaurant_id = (select id from public.restaurants where lower(code) = 'kampung-bulu');

alter table public.crew_sessions
  alter column restaurant_id set not null;

alter table public.crew_sessions
  add constraint crew_sessions_restaurant_id_fkey
  foreign key (restaurant_id) references public.restaurants (id) on delete restrict;

-- Update claim_crew_session to accept restaurant_id
create or replace function public.claim_crew_session(
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

  -- Verify restaurant exists and is active
  if not exists (
    select 1 from public.restaurants where id = p_restaurant_id and is_active = true
  ) then raise exception 'RESTAURANT_INACTIVE'; end if;

  update public.crew_sessions
  set connection_state = 'disconnected', offline_at = now(), updated_at = now()
  where connection_state in ('connecting', 'connected') and last_seen <= now() - interval '30 seconds';

  insert into public.crew_sessions (
    id, restaurant_id, normalized_name, display_name, device_description, audio_ready, visibility_state,
    connection_state, last_seen, offline_at
  )
  values (
    auth.uid(), p_restaurant_id, p_normalized_name, p_display_name, p_device_description, p_audio_ready,
    p_visibility_state, case when p_visibility_state = 'visible' then 'connecting' else 'disconnected' end,
    now(), case when p_visibility_state = 'visible' then null else now() end
  )
  on conflict (id) do update
  set restaurant_id = excluded.restaurant_id,
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

-- Update create_remote_command to scope by restaurant
create or replace function public.create_remote_command(
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
  if p_actor <> 'super-admin' or p_audio_id !~ '^(table:([1-9]|[1-6][0-9]|70)|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto))$' then
    raise exception 'INVALID_COMMAND';
  end if;

  insert into public.remote_commands (target_session_id, audio_id, actor, created_at, expires_at)
  select id, p_audio_id, p_actor, now(), now() + interval '5 seconds'
  from public.crew_sessions
  where id = p_target_session_id
    and connection_state = 'connected'
    and visibility_state = 'visible'
    and audio_ready = true
    and last_seen > now() - interval '30 seconds'
  returning * into result;
  if result.id is null then raise exception 'TARGET_NOT_ELIGIBLE'; end if;
  return result;
end;
$$;

-- Revoke old function signatures and grant new ones
revoke all on function public.claim_crew_session(text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.claim_crew_session(uuid, text, text, text, boolean, text) to authenticated;
