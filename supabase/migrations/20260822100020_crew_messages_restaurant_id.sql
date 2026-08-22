-- Add restaurant_id to crew_messages
alter table public.crew_messages
  add column restaurant_id uuid;

-- Backfill from crew_sessions
update public.crew_messages cm
  set restaurant_id = cs.restaurant_id
  from public.crew_sessions cs
  where cm.target_session_id = cs.id;

-- Set NOT NULL after backfill
alter table public.crew_messages
  alter column restaurant_id set not null;

alter table public.crew_messages
  add constraint crew_messages_restaurant_id_fkey
  foreign key (restaurant_id) references public.restaurants (id) on delete restrict;

-- Update create_crew_message to accept restaurant_id
create or replace function public.create_crew_message(
  p_target_session_id uuid,
  p_message text,
  p_restaurant_id uuid,
  p_expires_in_seconds bigint default 5
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public as $$
  declare v_id uuid;
begin
  if char_length(p_message) > 200 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  insert into public.crew_messages (target_session_id, message, restaurant_id, expires_at)
  values (p_target_session_id, p_message, p_restaurant_id, now() + make_interval(secs => p_expires_in_seconds))
  returning id into v_id;
  return v_id;
end;
$$;

-- Revoke old signature, grant new
revoke all on function public.create_crew_message(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.create_crew_message(uuid, text, uuid, bigint) to service_role;
