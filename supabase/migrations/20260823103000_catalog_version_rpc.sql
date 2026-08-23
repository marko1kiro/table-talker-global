create or replace function public.mutate_catalog(
  p_restaurant_id uuid,
  p_action text,
  p_audio_id text,
  p_item jsonb default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_version integer;
  v_next_version integer;
begin
  if p_action not in ('upsert', 'toggle', 'delete') or p_audio_id = '' then
    raise exception 'invalid catalog mutation';
  end if;

  select catalog_version into v_current_version
  from public.restaurants
  where id = p_restaurant_id
  for update;

  if not found then
    raise exception 'restaurant not found';
  end if;

  v_next_version := v_current_version + 1;
  update public.restaurants
  set catalog_version = v_next_version, updated_at = now()
  where id = p_restaurant_id;

  insert into public.audio_manifests (
    restaurant_id, audio_id, label, category, r2_url, content_hash, byte_size,
    active, ordering, catalog_version, created_at, updated_at
  )
  select restaurant_id, audio_id, label, category, r2_url, content_hash, byte_size,
    active, ordering, v_next_version, created_at, now()
  from public.audio_manifests
  where restaurant_id = p_restaurant_id
    and catalog_version = v_current_version;

  if p_action = 'upsert' then
    insert into public.audio_manifests (
      restaurant_id, audio_id, label, category, r2_url, content_hash, byte_size,
      active, ordering, catalog_version
    ) values (
      p_restaurant_id, p_audio_id, p_item->>'label', coalesce(p_item->>'category', 'BASE'),
      p_item->>'r2_url', p_item->>'content_hash', (p_item->>'byte_size')::integer,
      true, coalesce((p_item->>'ordering')::integer, 0), v_next_version
    )
    on conflict (restaurant_id, audio_id, catalog_version) do update set
      label = excluded.label,
      category = excluded.category,
      r2_url = excluded.r2_url,
      content_hash = excluded.content_hash,
      byte_size = excluded.byte_size,
      active = true,
      ordering = excluded.ordering,
      updated_at = now();
  elsif p_action = 'toggle' then
    update public.audio_manifests
    set active = coalesce((p_item->>'active')::boolean, active), updated_at = now()
    where restaurant_id = p_restaurant_id
      and audio_id = p_audio_id
      and catalog_version = v_next_version;
  else
    delete from public.audio_manifests
    where restaurant_id = p_restaurant_id
      and audio_id = p_audio_id
      and catalog_version = v_next_version;
  end if;

  return v_next_version;
end;
$$;

revoke all on function public.mutate_catalog(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mutate_catalog(uuid, text, text, jsonb) to service_role;
