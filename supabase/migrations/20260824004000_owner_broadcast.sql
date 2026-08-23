create table public.owner_broadcasts (
  id uuid primary key default extensions.gen_random_uuid(),
  actor text not null check (actor = 'super-admin'),
  scope text not null check (scope in ('restaurant', 'all')),
  restaurant_id uuid references public.restaurants(id) on delete restrict,
  message text not null check (char_length(message) between 1 and 200),
  created_at timestamptz not null default now()
);

create table public.owner_broadcast_deliveries (
  id uuid primary key default extensions.gen_random_uuid(),
  broadcast_id uuid not null references public.owner_broadcasts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete restrict,
  crew_session_id uuid references public.crew_sessions(id) on delete set null,
  crew_message_id uuid references public.crew_messages(id) on delete set null,
  status text not null check (status in ('delivered', 'rejected', 'expired', 'failed')),
  failure_code text,
  created_at timestamptz not null default now()
);

create table public.owner_broadcast_rate_limits (
  actor text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

create index owner_broadcasts_created_idx on public.owner_broadcasts(created_at desc);
create index owner_broadcast_deliveries_history_idx on public.owner_broadcast_deliveries(restaurant_id, created_at desc);

alter table public.owner_broadcasts enable row level security;
alter table public.owner_broadcast_deliveries enable row level security;
alter table public.owner_broadcast_rate_limits enable row level security;
revoke all on public.owner_broadcasts from public, anon, authenticated;
revoke all on public.owner_broadcast_deliveries from public, anon, authenticated;
revoke all on public.owner_broadcast_rate_limits from public, anon, authenticated;

create function public.check_owner_broadcast_rate_limit(
  p_actor text,
  p_max_requests integer default 10,
  p_window_seconds integer default 3600
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_allowed boolean;
begin
  insert into public.owner_broadcast_rate_limits(actor, window_started_at, request_count)
  values (p_actor, now(), 1)
  on conflict(actor) do update set
    request_count = case when owner_broadcast_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1 else owner_broadcast_rate_limits.request_count + 1 end,
    window_started_at = case when owner_broadcast_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now() else owner_broadcast_rate_limits.window_started_at end
  returning request_count <= p_max_requests into v_allowed;
  return v_allowed;
end;
$$;

create function public.create_owner_broadcast_delivery(
  p_broadcast_id uuid,
  p_restaurant_id uuid,
  p_crew_session_id uuid,
  p_message text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_message_id uuid;
begin
  if char_length(trim(p_message)) not between 1 and 200 then raise exception 'INVALID_MESSAGE'; end if;
  if not exists(select 1 from public.owner_broadcasts where id = p_broadcast_id) then raise exception 'BROADCAST_NOT_FOUND'; end if;
  if not exists(
    select 1 from public.crew_sessions
    where id = p_crew_session_id and restaurant_id = p_restaurant_id
      and connection_state = 'connected' and visibility_state = 'visible'
      and audio_ready = true and last_seen > now() - interval '30 seconds'
  ) then
    insert into public.owner_broadcast_deliveries(broadcast_id, restaurant_id, crew_session_id, status, failure_code)
    values(p_broadcast_id, p_restaurant_id, p_crew_session_id, 'rejected', 'TARGET_NOT_ELIGIBLE');
    return jsonb_build_object('status', 'rejected');
  end if;
  insert into public.crew_messages(target_session_id, restaurant_id, message, expires_at)
  values(p_crew_session_id, p_restaurant_id, trim(p_message), now() + interval '6 seconds') returning id into v_message_id;
  insert into public.owner_broadcast_deliveries(broadcast_id, restaurant_id, crew_session_id, crew_message_id, status)
  values(p_broadcast_id, p_restaurant_id, p_crew_session_id, v_message_id, 'delivered');
  return jsonb_build_object('status', 'delivered');
exception when others then
  if sqlerrm in ('INVALID_MESSAGE', 'BROADCAST_NOT_FOUND') then raise; end if;
  insert into public.owner_broadcast_deliveries(broadcast_id, restaurant_id, crew_session_id, status, failure_code)
  values(p_broadcast_id, p_restaurant_id, p_crew_session_id, 'failed', 'DELIVERY_FAILED');
  return jsonb_build_object('status', 'failed');
end;
$$;

revoke all on function public.check_owner_broadcast_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.create_owner_broadcast_delivery(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.check_owner_broadcast_rate_limit(text, integer, integer) to service_role;
grant execute on function public.create_owner_broadcast_delivery(uuid, uuid, uuid, text) to service_role;
