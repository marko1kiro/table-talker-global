-- L-01: tenant-authorized private Realtime Broadcast for table occupancy.
-- Existing role sessions remain valid: they are lazily bound to the current
-- authenticated Supabase user before the client opens its private channel.

alter table public.role_session_tokens
  add column auth_user_id uuid default auth.uid()
  references auth.users(id) on delete cascade;

create index role_session_tokens_auth_restaurant_idx
  on public.role_session_tokens (auth_user_id, restaurant_id)
  where auth_user_id is not null;

create or replace function public.bind_role_session_realtime(
  p_restaurant_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_bound boolean := false;
begin
  if v_auth_user_id is null then raise exception 'UNAUTHORIZED'; end if;

  update public.role_session_tokens rst
  set auth_user_id = v_auth_user_id
  from public.restaurants r
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role in ('kasir', 'satgas', 'clear_up')
    and rst.expires_at > now()
    and r.id = rst.restaurant_id
    and r.is_active
    and rst.code_version = r.code_version
    and (rst.auth_user_id is null or rst.auth_user_id = v_auth_user_id)
  returning true into v_bound;

  if not v_bound then raise exception 'INVALID_SESSION'; end if;
  return true;
end;
$$;
revoke all on function public.bind_role_session_realtime(uuid, text) from public, anon, service_role;
grant execute on function public.bind_role_session_realtime(uuid, text) to authenticated;

create or replace function public.can_read_table_occupancy_broadcast(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.role_session_tokens rst
    join public.restaurants r on r.id = rst.restaurant_id
    where rst.auth_user_id = auth.uid()
      and rst.role in ('kasir', 'satgas', 'clear_up')
      and rst.expires_at > now()
      and r.is_active
      and rst.code_version = r.code_version
      and p_topic = 'table-occupancy:' || rst.restaurant_id::text
  );
$$;
revoke all on function public.can_read_table_occupancy_broadcast(text) from public, anon, service_role;
grant execute on function public.can_read_table_occupancy_broadcast(text) to authenticated;

drop policy if exists "role sessions read own occupancy broadcasts" on realtime.messages;
create policy "role sessions read own occupancy broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and public.can_read_table_occupancy_broadcast(realtime.topic())
);

-- Re-emit the five latest M-02 mutation definitions unchanged except for
-- realtime.send(..., true). Browser clients receive no INSERT policy.

create or replace function public.set_table_occupied_kasir(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'kasir'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'kasir')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi',
    occupied_at = now(),
    occupied_source = 'kasir',
    updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if found then
    update public.table_escort_intents
    set resolved = true
    where restaurant_id = p_restaurant_id
      and table_number = p_table_number
      and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      true
    );
  end if;
end;
$$;
revoke all on function public.set_table_occupied_kasir(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_occupied_kasir(uuid, integer, text) to authenticated;

create or replace function public.set_table_empty_cleanup(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'clear_up'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'kosong', null, null)
  on conflict (restaurant_id, table_number) do update set
    status = 'kosong',
    occupied_at = null,
    occupied_source = null,
    updated_at = now()
  where public.table_occupancy_state.status = 'terisi';

  if found then
    update public.table_escort_intents
    set resolved = true
    where restaurant_id = p_restaurant_id
      and table_number = p_table_number
      and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      true
    );
  end if;
end;
$$;
revoke all on function public.set_table_empty_cleanup(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_empty_cleanup(uuid, integer, text) to authenticated;

create or replace function public.create_escort_intent(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_existing record;
  v_existing_actor uuid;
  v_id uuid;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  select * into v_existing
  from public.table_escort_intents
  where restaurant_id = p_restaurant_id
    and table_number = p_table_number
    and resolved = false
  for update;

  if v_existing is not null then
    if v_existing.actor_session_id = v_session.role_session_id then
      return v_existing.id;
    else
      raise exception 'ALREADY_ESCORTED';
    end if;
  end if;

  begin
    insert into public.table_escort_intents (restaurant_id, table_number, actor_session_id, expires_at)
    values (p_restaurant_id, p_table_number, v_session.role_session_id, now() + interval '10 minutes')
    returning id into v_id;
  exception
    when unique_violation then
      select id, actor_session_id into v_id, v_existing_actor
      from public.table_escort_intents
      where restaurant_id = p_restaurant_id
        and table_number = p_table_number
        and resolved = false;
      if v_existing_actor = v_session.role_session_id then
        return v_id;
      else
        raise exception 'ALREADY_ESCORTED';
      end if;
  end;

  v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', p_table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || p_restaurant_id::text,
    true
  );
  return v_id;
end;
$$;
revoke all on function public.create_escort_intent(uuid, integer, text) from public, anon, service_role;
grant execute on function public.create_escort_intent(uuid, integer, text) to authenticated;

create or replace function public.confirm_escort_intent(
  p_intent_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_intent record;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_intent
  from public.table_escort_intents
  where id = p_intent_id
    and restaurant_id = v_session.restaurant_id
    and actor_session_id = v_session.role_session_id
    and expires_at <= now()
    and resolved = false;
  if v_intent is null then raise exception 'INTENT_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id
      and table_number = v_intent.table_number
      and status = 'kosong'
  ) and exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id
      and table_number = v_intent.table_number
  ) then raise exception 'ALREADY_OCCUPIED'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (v_intent.restaurant_id, v_intent.table_number, 'terisi', now(), 'satgas_escort')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi',
    occupied_at = now(),
    occupied_source = 'satgas_escort',
    updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if not found then raise exception 'ALREADY_OCCUPIED'; end if;

  update public.table_escort_intents set resolved = true where id = p_intent_id;
  v_revision := public.bump_table_occupancy_revision(v_intent.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || v_intent.restaurant_id::text,
    true
  );
end;
$$;
revoke all on function public.confirm_escort_intent(uuid, text) from public, anon, service_role;
grant execute on function public.confirm_escort_intent(uuid, text) to authenticated;

create or replace function public.record_qr_scan(
  p_restaurant_id uuid,
  p_table_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;
  if not exists (
    select 1 from public.restaurants
    where id = p_restaurant_id and is_active
  ) then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  insert into public.qr_scan_events (restaurant_id, table_number)
  values (p_restaurant_id, p_table_number);

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'qr_scan')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi',
    occupied_at = now(),
    occupied_source = 'qr_scan',
    updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if found then
    update public.table_escort_intents
    set resolved = true
    where restaurant_id = p_restaurant_id
      and table_number = p_table_number
      and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      true
    );
  end if;
end;
$$;
revoke all on function public.record_qr_scan(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_qr_scan(uuid, integer) to service_role;
