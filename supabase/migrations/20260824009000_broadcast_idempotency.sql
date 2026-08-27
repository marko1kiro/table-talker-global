alter table public.owner_broadcasts
  add column idempotency_key uuid,
  add column payload_fingerprint text,
  add column status text not null default 'creating' check (status in ('creating', 'complete')),
  add column processing_started_at timestamptz not null default now(),
  add column snapshot_created_at timestamptz,
  add column processing_token uuid;

create table public.owner_broadcast_targets (
  broadcast_id uuid not null references public.owner_broadcasts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (broadcast_id, restaurant_id)
);

create table public.owner_broadcast_recipients (
  broadcast_id uuid not null references public.owner_broadcasts(id) on delete cascade,
  crew_session_id uuid not null references public.crew_sessions(id) on delete restrict,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (broadcast_id, crew_session_id)
);

alter table public.owner_broadcast_targets enable row level security;
revoke all on public.owner_broadcast_targets from public, anon, authenticated;
alter table public.owner_broadcast_recipients enable row level security;
revoke all on public.owner_broadcast_recipients from public, anon, authenticated;

update public.owner_broadcasts
set scope = 'all', restaurant_id = null
where (scope = 'all' and restaurant_id is not null)
   or (scope = 'restaurant' and restaurant_id is null);

update public.owner_broadcasts
set idempotency_key = extensions.gen_random_uuid(),
    payload_fingerprint = encode(extensions.digest(id::text || actor || scope || coalesce(restaurant_id::text, '') || message, 'sha256'), 'hex'),
    processing_token = extensions.gen_random_uuid()
where idempotency_key is null or payload_fingerprint is null or processing_token is null;

alter table public.owner_broadcasts
  alter column idempotency_key set not null,
  alter column payload_fingerprint set not null,
  alter column processing_token set not null,
  add constraint owner_broadcasts_payload_fingerprint_check check (payload_fingerprint ~ '^[0-9a-f]{64}$'),
  add constraint owner_broadcasts_scope_restaurant_check check (
    (scope = 'all' and restaurant_id is null)
    or (scope = 'restaurant' and restaurant_id is not null)
  );

create unique index owner_broadcasts_actor_idempotency_key_unique
  on public.owner_broadcasts(actor, idempotency_key);

with ranked_deliveries as (
  select id,
    row_number() over (
      partition by broadcast_id, crew_session_id
      order by
        (status = 'delivered' and crew_message_id is not null) desc,
        created_at asc,
        id asc
    ) as row_number
  from public.owner_broadcast_deliveries
  where crew_session_id is not null
)
delete from public.owner_broadcast_deliveries
where id in (select id from ranked_deliveries where row_number > 1);

create unique index owner_broadcast_delivery_session_unique
  on public.owner_broadcast_deliveries(broadcast_id, crew_session_id)
  where crew_session_id is not null;

create or replace function public.create_or_get_owner_broadcast(
  p_key uuid,
  p_fingerprint text,
  p_actor text,
  p_scope text,
  p_restaurant_id uuid,
  p_message text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare v_broadcast public.owner_broadcasts; v_allowed boolean;
begin
  if p_key is null or p_fingerprint !~ '^[0-9a-f]{64}$' or p_actor <> 'super-admin'
    or p_scope not in ('restaurant', 'all') or char_length(trim(p_message)) not between 1 and 200
    or p_message <> trim(p_message)
    or (p_scope = 'all' and p_restaurant_id is not null)
    or (p_scope = 'restaurant' and p_restaurant_id is null) then
    raise exception 'INVALID_BROADCAST';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_actor || ':' || p_key::text, 0));
  select * into v_broadcast from public.owner_broadcasts
  where actor = p_actor and idempotency_key = p_key;
  if found then
    if v_broadcast.payload_fingerprint <> p_fingerprint
      or v_broadcast.scope <> p_scope
      or v_broadcast.restaurant_id is distinct from p_restaurant_id
      or v_broadcast.message <> p_message then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    if v_broadcast.status = 'creating'
      and v_broadcast.processing_started_at <= now() - interval '30 seconds' then
      update public.owner_broadcasts set processing_started_at = now(), processing_token = extensions.gen_random_uuid() where id = v_broadcast.id
      returning * into v_broadcast;
      return jsonb_build_object('id', v_broadcast.id, 'replayed', true, 'status', v_broadcast.status, 'resume', true, 'snapshotCreated', v_broadcast.snapshot_created_at is not null, 'processingToken', v_broadcast.processing_token);
    end if;
    if v_broadcast.status = 'creating' then raise exception 'IN_PROGRESS'; end if;
    return jsonb_build_object('id', v_broadcast.id, 'replayed', true, 'status', v_broadcast.status, 'resume', false, 'snapshotCreated', v_broadcast.snapshot_created_at is not null, 'processingToken', v_broadcast.processing_token);
  end if;

  insert into public.owner_broadcast_rate_limits(actor, window_started_at, request_count)
  values (p_actor, now(), 1)
  on conflict(actor) do update set
    request_count = case when owner_broadcast_rate_limits.window_started_at <= now() - interval '1 hour' then 1 else owner_broadcast_rate_limits.request_count + 1 end,
    window_started_at = case when owner_broadcast_rate_limits.window_started_at <= now() - interval '1 hour' then now() else owner_broadcast_rate_limits.window_started_at end
  returning request_count <= 10 into v_allowed;
  if not v_allowed then raise exception 'RATE_LIMITED'; end if;

  insert into public.owner_broadcasts(actor, scope, restaurant_id, message, idempotency_key, payload_fingerprint, processing_token)
  values (p_actor, p_scope, p_restaurant_id, p_message, p_key, p_fingerprint, extensions.gen_random_uuid())
  returning * into v_broadcast;
  return jsonb_build_object('id', v_broadcast.id, 'replayed', false, 'status', v_broadcast.status, 'resume', false, 'snapshotCreated', false, 'processingToken', v_broadcast.processing_token);
end;
$$;

create or replace function public.record_owner_broadcast_snapshot(
  p_broadcast_id uuid,
  p_processing_token uuid,
  p_targets jsonb
) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_broadcast public.owner_broadcasts; v_target jsonb; v_session text;
begin
  select * into v_broadcast from public.owner_broadcasts where id = p_broadcast_id for update;
  if not found or v_broadcast.status <> 'creating' or jsonb_typeof(p_targets) <> 'array' then
    raise exception 'INVALID_BROADCAST_TARGETS';
  end if;
  if v_broadcast.processing_token <> p_processing_token then raise exception 'LEASE_LOST'; end if;
  if v_broadcast.snapshot_created_at is not null then raise exception 'SNAPSHOT_ALREADY_RECORDED'; end if;
  for v_target in select value from jsonb_array_elements(p_targets) loop
    if not exists(
      select 1 from public.owner_broadcast_targets
      where broadcast_id = p_broadcast_id
        and restaurant_id = (v_target->>'restaurantId')::uuid
        and display_name = v_target->>'displayName'
    ) and not exists(
      select 1 from public.restaurants
      where id = (v_target->>'restaurantId')::uuid
        and display_name = v_target->>'displayName'
        and (v_broadcast.scope = 'all' or id = v_broadcast.restaurant_id)
    ) then raise exception 'BROADCAST_TARGET_MISMATCH'; end if;
    for v_session in select jsonb_array_elements_text(coalesce(v_target->'sessionIds', '[]'::jsonb)) loop
      if not exists(
        select 1 from public.crew_sessions
        where id = v_session::uuid and restaurant_id = (v_target->>'restaurantId')::uuid
          and connection_state = 'connected' and visibility_state = 'visible' and audio_ready = true
          and last_seen > now() - interval '30 seconds'
      ) then raise exception 'BROADCAST_RECIPIENT_MISMATCH'; end if;
    end loop;
  end loop;
  insert into public.owner_broadcast_targets(broadcast_id, restaurant_id, display_name)
  select p_broadcast_id, (value->>'restaurantId')::uuid, value->>'displayName'
  from jsonb_array_elements(p_targets)
  on conflict (broadcast_id, restaurant_id) do nothing;
  insert into public.owner_broadcast_recipients(broadcast_id, crew_session_id, restaurant_id)
  select p_broadcast_id, session_id::uuid, (target->>'restaurantId')::uuid
  from jsonb_array_elements(p_targets) target,
    jsonb_array_elements_text(coalesce(target->'sessionIds', '[]'::jsonb)) session_id
  on conflict (broadcast_id, crew_session_id) do nothing;
  update public.owner_broadcasts set snapshot_created_at = now() where id = p_broadcast_id;
end;
$$;

create or replace function public.finalize_owner_broadcast(p_broadcast_id uuid, p_processing_token uuid)
returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_broadcast public.owner_broadcasts;
begin
  select * into v_broadcast from public.owner_broadcasts
  where id = p_broadcast_id
  for update;
  if not found or v_broadcast.status <> 'creating' then raise exception 'BROADCAST_NOT_CREATING'; end if;
  if v_broadcast.processing_token <> p_processing_token then raise exception 'LEASE_LOST'; end if;
  if v_broadcast.snapshot_created_at is null then raise exception 'BROADCAST_INCOMPLETE'; end if;
  if exists(
    select 1 from public.owner_broadcast_recipients r
    left join public.owner_broadcast_deliveries d
      on d.broadcast_id = r.broadcast_id and d.crew_session_id = r.crew_session_id
    where r.broadcast_id = p_broadcast_id and d.crew_session_id is null
  ) then raise exception 'BROADCAST_INCOMPLETE'; end if;
  update public.owner_broadcasts set status = 'complete' where id = p_broadcast_id;
end;
$$;

drop function if exists public.create_owner_broadcast_delivery(uuid, uuid, uuid, text);

create function public.create_owner_broadcast_delivery(
  p_broadcast_id uuid,
  p_processing_token uuid,
  p_restaurant_id uuid,
  p_crew_session_id uuid,
  p_message text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_message_id uuid; v_status text; v_broadcast public.owner_broadcasts;
begin
  if p_crew_session_id is null or char_length(trim(p_message)) not between 1 and 200 or p_message <> trim(p_message) then raise exception 'INVALID_MESSAGE'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_broadcast_id::text || ':' || p_crew_session_id::text, 0));
  select * into v_broadcast from public.owner_broadcasts where id = p_broadcast_id for update;
  if not found then raise exception 'BROADCAST_NOT_FOUND'; end if;
  if v_broadcast.status <> 'creating' or v_broadcast.processing_token <> p_processing_token then raise exception 'LEASE_LOST'; end if;
  if (v_broadcast.scope <> 'all' and v_broadcast.restaurant_id is distinct from p_restaurant_id)
    or v_broadcast.message <> p_message then raise exception 'BROADCAST_PAYLOAD_MISMATCH'; end if;
  if not exists(
    select 1 from public.owner_broadcast_recipients
    where broadcast_id = p_broadcast_id
      and restaurant_id = p_restaurant_id
      and crew_session_id = p_crew_session_id
  ) then raise exception 'RECIPIENT_NOT_SNAPSHOTTED'; end if;
  select status into v_status from public.owner_broadcast_deliveries
  where broadcast_id = p_broadcast_id and crew_session_id = p_crew_session_id;
  if found then return jsonb_build_object('status', v_status); end if;
  if not exists(
    select 1 from public.crew_sessions where id = p_crew_session_id and restaurant_id = p_restaurant_id
      and connection_state = 'connected' and visibility_state = 'visible' and audio_ready = true
      and last_seen > now() - interval '30 seconds'
  ) then
    insert into public.owner_broadcast_deliveries(broadcast_id, restaurant_id, crew_session_id, status, failure_code)
    values(p_broadcast_id, p_restaurant_id, p_crew_session_id, 'rejected', 'TARGET_NOT_ELIGIBLE');
    return jsonb_build_object('status', 'rejected');
  end if;
  insert into public.crew_messages(target_session_id, restaurant_id, message, expires_at)
  values(p_crew_session_id, p_restaurant_id, p_message, now() + interval '6 seconds') returning id into v_message_id;
  insert into public.owner_broadcast_deliveries(broadcast_id, restaurant_id, crew_session_id, crew_message_id, status)
  values(p_broadcast_id, p_restaurant_id, p_crew_session_id, v_message_id, 'delivered');
  return jsonb_build_object('status', 'delivered');
exception when others then
  if sqlerrm in ('INVALID_MESSAGE', 'BROADCAST_NOT_FOUND', 'BROADCAST_PAYLOAD_MISMATCH', 'RECIPIENT_NOT_SNAPSHOTTED', 'LEASE_LOST') then raise; end if;
  insert into public.owner_broadcast_deliveries(broadcast_id, restaurant_id, crew_session_id, status, failure_code)
  values(p_broadcast_id, p_restaurant_id, p_crew_session_id, 'failed', 'DELIVERY_FAILED')
  on conflict (broadcast_id, crew_session_id) where crew_session_id is not null do nothing;
  return jsonb_build_object('status', 'failed');
end;
$$;

revoke all on function public.create_or_get_owner_broadcast(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.create_or_get_owner_broadcast(uuid, text, text, text, uuid, text) to service_role;
revoke all on function public.create_owner_broadcast_delivery(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_owner_broadcast_delivery(uuid, uuid, uuid, uuid, text) to service_role;
revoke all on function public.record_owner_broadcast_snapshot(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_owner_broadcast_snapshot(uuid, uuid, jsonb) to service_role;
revoke all on function public.finalize_owner_broadcast(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finalize_owner_broadcast(uuid, uuid) to service_role;
