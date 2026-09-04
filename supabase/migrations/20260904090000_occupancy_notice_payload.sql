-- Enrich the private occupancy broadcast with a human-readable notice payload
-- (kind + actor) so crew UIs can show "what changed / who did it". Status,
-- revision-bump, escort, and debounce behavior are unchanged from the deployed
-- definitions; only the realtime.send jsonb is extended. ACLs are preserved by
-- CREATE OR REPLACE (no grant changes here).

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
  v_actor_name text;
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
    status = 'terisi', occupied_at = now(), occupied_source = 'kasir', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if found then
    update public.table_escort_intents set resolved = true
    where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    select crs.display_name into v_actor_name from public.crew_role_sessions crs
      where crs.id = v_session.role_session_id;
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
        'kind', 'occupied', 'actor_role', 'kasir',
        'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
      'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
    );
  end if;
end;
$$;

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
  v_actor_name text;
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
    status = 'kosong', occupied_at = null, occupied_source = null, updated_at = now()
  where public.table_occupancy_state.status = 'terisi';

  if found then
    update public.table_escort_intents set resolved = true
    where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    select crs.display_name into v_actor_name from public.crew_role_sessions crs
      where crs.id = v_session.role_session_id;
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
        'kind', 'cleared', 'actor_role', 'clear_up',
        'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
      'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
    );
  end if;
end;
$$;

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
  v_actor_name text;
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
  where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false
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
      where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;
      if v_existing_actor = v_session.role_session_id then
        return v_id;
      else
        raise exception 'ALREADY_ESCORTED';
      end if;
  end;

  v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
  select crs.display_name into v_actor_name from public.crew_role_sessions crs
    where crs.id = v_session.role_session_id;
  perform realtime.send(
    jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
      'kind', 'escorted', 'actor_role', 'satgas',
      'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
    'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
  );
  return v_id;
end;
$$;

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
  v_actor_name text;
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
  where id = p_intent_id and restaurant_id = v_session.restaurant_id
    and actor_session_id = v_session.role_session_id
    and expires_at <= now() and resolved = false;
  if v_intent is null then raise exception 'INTENT_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id and table_number = v_intent.table_number and status = 'kosong'
  ) and exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id and table_number = v_intent.table_number
  ) then raise exception 'ALREADY_OCCUPIED'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (v_intent.restaurant_id, v_intent.table_number, 'terisi', now(), 'satgas_escort')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi', occupied_at = now(), occupied_source = 'satgas_escort', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if not found then raise exception 'ALREADY_OCCUPIED'; end if;

  update public.table_escort_intents set resolved = true where id = p_intent_id;
  v_revision := public.bump_table_occupancy_revision(v_intent.restaurant_id);
  select crs.display_name into v_actor_name from public.crew_role_sessions crs
    where crs.id = v_session.role_session_id;
  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number, 'revision', v_revision,
      'kind', 'occupied', 'actor_role', 'satgas',
      'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
    'invalidate', 'table-occupancy:' || v_intent.restaurant_id::text, true
  );
end;
$$;

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
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_active) then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  insert into public.qr_scan_events (restaurant_id, table_number)
  values (p_restaurant_id, p_table_number);

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'qr_scan')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi', occupied_at = now(), occupied_source = 'qr_scan', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if found then
    update public.table_escort_intents set resolved = true
    where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
        'kind', 'occupied', 'actor_role', 'qr_scan',
        'actor_name', null, 'actor_role_session_id', null),
      'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
    );
  end if;
end;
$$;

create or replace function public.decline_qr_scan(
  p_scan_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.pending_qr_scans%rowtype;
  v_revision bigint;
begin
  if p_scan_id is null then return false; end if;

  select * into v_scan
  from public.pending_qr_scans
  where scan_id = p_scan_id and status = 'processed'
    and created_at >= now() - interval '10 minutes'
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from public.qr_scan_events
    where restaurant_id = v_scan.restaurant_id and table_number = v_scan.table_number
      and scanned_at > v_scan.processed_at
  ) then return false; end if;

  update public.table_occupancy_state
  set status = 'kosong', occupied_at = null, occupied_source = null, updated_at = now()
  where restaurant_id = v_scan.restaurant_id and table_number = v_scan.table_number
    and status = 'terisi' and occupied_source = 'qr_scan';
  if not found then return false; end if;

  update public.table_escort_intents set resolved = true
  where restaurant_id = v_scan.restaurant_id and table_number = v_scan.table_number and resolved = false;

  v_revision := public.bump_table_occupancy_revision(v_scan.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_scan.table_number, 'revision', v_revision,
      'kind', 'cancelled', 'actor_role', 'qr_scan',
      'actor_name', null, 'actor_role_session_id', null),
    'invalidate', 'table-occupancy:' || v_scan.restaurant_id::text, true
  );

  update public.pending_qr_scans
  set status = 'terminal', terminal_at = now(), terminal_reason = 'CUSTOMER_DECLINED'
  where scan_id = p_scan_id;

  return true;
end;
$$;
