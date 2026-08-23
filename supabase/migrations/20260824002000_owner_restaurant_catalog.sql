-- Abort rather than rewriting pilot catalog rows outside owner catalog contract.
do $$
begin
  if exists (
    select 1 from public.audio_manifests
    where audio_id !~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|jam-buka-resto|outside-food|no-smoking|larangan-gabung-meja)|custom:[a-z0-9][a-z0-9_-]{0,99})$'
  ) then
    raise exception 'existing audio manifest catalog IDs are invalid';
  end if;
end;
$$;

alter table public.audio_manifests
  add constraint audio_manifests_audio_id_check
  check (audio_id ~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|jam-buka-resto|outside-food|no-smoking|larangan-gabung-meja)|custom:[a-z0-9][a-z0-9_-]{0,99})$');

create index if not exists crew_sessions_restaurant_presence_idx
  on public.crew_sessions (restaurant_id, connection_state, visibility_state, last_seen desc);

create or replace function public.owner_restaurant_list()
returns jsonb language sql security definer set search_path = public set statement_timeout = '3000ms' as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'display_name'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'id', r.id, 'display_name', r.display_name, 'is_active', r.is_active,
      'online_devices', (select count(*) from crew_sessions s where s.restaurant_id = r.id and s.connection_state = 'connected' and s.visibility_state = 'visible' and s.last_seen > now() - interval '30 seconds'),
      'catalog_version', r.catalog_version,
      'latest_sync_failure', (select jsonb_build_object('occurred_at', e.occurred_at, 'report_code', e.report_code) from operational_errors e where e.restaurant_id = r.id and e.stage = 'sync_cache' and e.resolved_at is null order by e.occurred_at desc limit 1),
      'plays_today', (select count(*) from playback_events p where p.restaurant_id = r.id and p.status = 'played' and p.event_timestamp >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')
    ) row_data from restaurants r
  ) rows;
$$;

create or replace function public.owner_restaurant_detail(p_restaurant_id uuid)
returns jsonb language sql security definer set search_path = public set statement_timeout = '3000ms' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('id', r.id, 'display_name', r.display_name, 'is_active', r.is_active, 'catalog_version', r.catalog_version, 'credential_rotated_at', r.credential_rotated_at),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'display_name', s.display_name, 'device_description', s.device_description, 'audio_ready', s.audio_ready, 'connection_state', s.connection_state, 'visibility_state', s.visibility_state, 'last_seen', s.last_seen) order by s.last_seen desc) from (select id, display_name, device_description, audio_ready, connection_state, visibility_state, last_seen from crew_sessions where restaurant_id = r.id order by last_seen desc limit 20) s), '[]'::jsonb),
    'catalog', jsonb_build_object('total', (select count(*) from audio_manifests m where m.restaurant_id = r.id and m.catalog_version = r.catalog_version), 'items', coalesce((select jsonb_agg(jsonb_build_object('audio_id', m.audio_id, 'label', m.label, 'category', m.category, 'active', m.active, 'ordering', m.ordering) order by m.category, m.ordering) from (select audio_id, label, category, active, ordering from audio_manifests where restaurant_id = r.id and catalog_version = r.catalog_version order by category, ordering limit 200) m), '[]'::jsonb)),
    'recent_playback', coalesce((select jsonb_agg(jsonb_build_object('audio_id', p.audio_id, 'label', p.label, 'event_timestamp', p.event_timestamp, 'crew_name', p.crew_name, 'status', p.status, 'error_detail', p.error_detail) order by p.event_timestamp desc) from (select audio_id, label, event_timestamp, crew_name, status, error_detail from playback_events where restaurant_id = r.id order by event_timestamp desc limit 20) p), '[]'::jsonb),
    'recent_errors', coalesce((select jsonb_agg(jsonb_build_object('stage', e.stage, 'report_code', e.report_code, 'detail', e.detail, 'occurred_at', e.occurred_at, 'resolved_at', e.resolved_at) order by e.occurred_at desc) from (select stage, report_code, detail, occurred_at, resolved_at from operational_errors where restaurant_id = r.id order by occurred_at desc limit 20) e), '[]'::jsonb),
    'sync_history', coalesce((select jsonb_agg(jsonb_build_object('report_code', e.report_code, 'detail', e.detail, 'occurred_at', e.occurred_at, 'resolved_at', e.resolved_at) order by e.occurred_at desc) from (select report_code, detail, occurred_at, resolved_at from operational_errors where restaurant_id = r.id and stage = 'sync_cache' order by occurred_at desc limit 20) e), '[]'::jsonb)
  ) from restaurants r where r.id = p_restaurant_id;
$$;

revoke all on function public.owner_restaurant_list() from public, anon, authenticated;
revoke all on function public.owner_restaurant_detail(uuid) from public, anon, authenticated;
grant execute on function public.owner_restaurant_list() to service_role;
grant execute on function public.owner_restaurant_detail(uuid) to service_role;

create or replace function public.mutate_catalog(p_restaurant_id uuid, p_action text, p_audio_id text, p_item jsonb default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_current_version integer; v_next_version integer; v_exists boolean;
begin
  if p_action not in ('upsert', 'toggle', 'delete', 'reorder') or p_audio_id !~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|jam-buka-resto|outside-food|no-smoking|larangan-gabung-meja)|custom:[a-z0-9][a-z0-9_-]{0,99})$' then raise exception 'invalid catalog item'; end if;
  if p_action = 'upsert' and (coalesce(char_length(p_item->>'label'), 0) not between 1 and 200 or coalesce(char_length(p_item->>'category'), 0) not between 1 and 60 or coalesce(p_item->>'r2_url', '') !~ '^https://.+' or coalesce(p_item->>'content_hash', '') !~ '^[0-9a-f]{64}$' or coalesce((p_item->>'byte_size')::integer, 0) not between 1048576 and 10485760) then raise exception 'invalid catalog metadata'; end if;
  if p_action in ('upsert', 'reorder') and (coalesce((p_item->>'ordering')::integer, -1) < 0 or coalesce((p_item->>'ordering')::integer, 10001) > 10000) then raise exception 'invalid catalog ordering'; end if;
  select catalog_version into v_current_version from restaurants where id = p_restaurant_id for update;
  if not found then raise exception 'restaurant not found'; end if;
  if p_action in ('toggle', 'delete', 'reorder') then select exists(select 1 from audio_manifests where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_current_version) into v_exists; if not v_exists then raise exception 'catalog item not found'; end if; end if;
  v_next_version := v_current_version + 1;
  update restaurants set catalog_version = v_next_version, updated_at = now() where id = p_restaurant_id;
  insert into audio_manifests (restaurant_id,audio_id,label,category,r2_url,content_hash,byte_size,active,ordering,catalog_version,created_at,updated_at)
  select restaurant_id,audio_id,label,category,r2_url,content_hash,byte_size,active,ordering,v_next_version,created_at,now() from audio_manifests where restaurant_id=p_restaurant_id and catalog_version=v_current_version;
  if p_action = 'upsert' then
    insert into audio_manifests (restaurant_id,audio_id,label,category,r2_url,content_hash,byte_size,active,ordering,catalog_version) values (p_restaurant_id,p_audio_id,p_item->>'label',coalesce(p_item->>'category','BASE'),p_item->>'r2_url',p_item->>'content_hash',(p_item->>'byte_size')::integer,true,coalesce((p_item->>'ordering')::integer,0),v_next_version) on conflict (restaurant_id,audio_id,catalog_version) do update set label=excluded.label,category=excluded.category,r2_url=excluded.r2_url,content_hash=excluded.content_hash,byte_size=excluded.byte_size,active=true,ordering=excluded.ordering,updated_at=now();
  elsif p_action = 'toggle' then update audio_manifests set active=coalesce((p_item->>'active')::boolean,active),updated_at=now() where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_next_version;
  elsif p_action = 'reorder' then update audio_manifests set ordering=(p_item->>'ordering')::integer,updated_at=now() where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_next_version;
  else delete from audio_manifests where restaurant_id=p_restaurant_id and audio_id=p_audio_id and catalog_version=v_next_version;
  end if; return v_next_version;
end; $$;
