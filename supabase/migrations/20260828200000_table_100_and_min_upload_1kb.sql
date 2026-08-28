-- Raise legacy remote_commands table:N ceiling from 70 to 100 for consistency with the
-- active owner catalog contract (audio_manifests / mutate_catalog already allow table:1-100).
-- This function/table path has no active callers in the current app (broadcast feature uses
-- a separate RPC architecture), but is kept in sync defensively since remote_commands remains
-- wired into realtime and is still read by the crew client.
alter table public.remote_commands
  drop constraint if exists remote_commands_audio_id_check;

alter table public.remote_commands
  add constraint remote_commands_audio_id_check
  check (audio_id ~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto))$');

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
  if p_actor <> 'super-admin' or p_audio_id !~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto))$' then raise exception 'INVALID_COMMAND'; end if;

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

grant execute on function public.create_remote_command(uuid, text, text) to service_role;

-- Lower the owner catalog minimum upload size from 1 MB to 1 KB (max stays 10 MB).
create or replace function public.mutate_catalog(p_restaurant_id uuid, p_action text, p_audio_id text, p_item jsonb default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_current_version integer; v_next_version integer; v_exists boolean;
begin
  if p_action not in ('upsert', 'toggle', 'delete', 'reorder') or p_audio_id !~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|jam-buka-resto|outside-food|no-smoking|larangan-gabung-meja)|custom:[a-z0-9][a-z0-9_-]{0,99})$' then raise exception 'invalid catalog item'; end if;
  if p_action = 'upsert' and (coalesce(char_length(p_item->>'label'), 0) not between 1 and 200 or coalesce(char_length(p_item->>'category'), 0) not between 1 and 60 or coalesce(p_item->>'r2_url', '') !~ '^https://.+' or coalesce(p_item->>'content_hash', '') !~ '^[0-9a-f]{64}$' or coalesce((p_item->>'byte_size')::integer, 0) not between 1024 and 10485760) then raise exception 'invalid catalog metadata'; end if;
  if p_action in ('upsert', 'reorder') and (coalesce((p_item->>'ordering')::integer, -1) < 0 or coalesce((p_item->>'ordering')::integer, 10001) > 10000) then raise exception 'invalid catalog ordering'; end if;
  select catalog_version into v_current_version from restaurants where id = p_restaurant_id for update;
  if not found then raise exception 'restaurant not found'; end if;
  if p_action in ('toggle', 'delete', 'reorder') then select exists(select 1 from audio_manifests where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_current_version) into v_exists; if not v_exists then raise exception 'catalog item not found'; end if; end if;
  v_next_version := v_current_version + 1;
  update restaurants set catalog_version = v_next_version, updated_at = now() where id = p_restaurant_id;
  insert into audio_manifests (restaurant_id,audio_id,label,category,r2_url,content_hash,byte_size,active,ordering,catalog_version,created_at,updated_at)
  select restaurant_id,audio_id,label,category,r2_url,content_hash,byte_size,active,ordering,v_next_version,created_at,now() from audio_manifests where restaurant_id=p_restaurant_id and catalog_version=v_current_version;
  if p_action = 'upsert' then
    insert into audio_manifests (restaurant_id,audio_id,label,category,r2_url,content_hash,byte_size,active,ordering,catalog_version) values (p_restaurant_id,p_audio_id,p_item->>'label',coalesce(p_item->>'category','BASE'),p_item->>'r2_url',p_item->>'content_hash',(p_item->>'byte_size')::integer,coalesce((p_item->>'active')::boolean,true),coalesce((p_item->>'ordering')::integer,0),v_next_version) on conflict (restaurant_id,audio_id,catalog_version) do update set label=excluded.label,category=excluded.category,r2_url=excluded.r2_url,content_hash=excluded.content_hash,byte_size=excluded.byte_size,active=excluded.active,ordering=excluded.ordering,updated_at=now();
  elsif p_action = 'toggle' then update audio_manifests set active=coalesce((p_item->>'active')::boolean,active),updated_at=now() where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_next_version;
  elsif p_action = 'reorder' then update audio_manifests set ordering=(p_item->>'ordering')::integer,updated_at=now() where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_next_version;
  else delete from audio_manifests where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_next_version;
  end if; return v_next_version;
end; $$;
