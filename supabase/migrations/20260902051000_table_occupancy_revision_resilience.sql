-- M-02: make occupancy invalidation loss detectable and self-healing.
-- A monotonic per-restaurant revision is returned with each snapshot and
-- broadcast with every snapshot-changing mutation. The legacy snapshot RPC
-- remains available for rollout compatibility, with H-01 validation restored.

create table public.table_occupancy_revisions (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);

alter table public.table_occupancy_revisions enable row level security;
revoke all on table public.table_occupancy_revisions from public, anon, authenticated, service_role;

create or replace function public.bump_table_occupancy_revision(p_restaurant_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  insert into public.table_occupancy_revisions (restaurant_id, revision, updated_at)
  values (p_restaurant_id, 1, now())
  on conflict (restaurant_id) do update set
    revision = table_occupancy_revisions.revision + 1,
    updated_at = now()
  returning revision into v_revision;

  return v_revision;
end;
$$;
revoke all on function public.bump_table_occupancy_revision(uuid) from public, anon, authenticated, service_role;

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
      false
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
      false
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
    false
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
    false
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
      false
    );
  end if;
end;
$$;
revoke all on function public.record_qr_scan(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_qr_scan(uuid, integer) to service_role;

-- Keep the legacy response shape for old deployments while restoring the
-- active-restaurant/code-version checks overwritten by the H-04 migration.
create or replace function public.get_table_occupancy_snapshot(
  p_restaurant_id uuid,
  p_session_token text
)
returns table (
  table_number integer,
  status text,
  occupied_at timestamptz,
  occupied_source text,
  escort_intent_id uuid,
  escort_intent_expires_at timestamptz,
  escort_intent_mine boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role <> 'ss'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  return query
  select
    tos.table_number,
    tos.status,
    tos.occupied_at,
    tos.occupied_source,
    null::uuid,
    null::timestamptz,
    false
  from public.table_occupancy_state tos
  where tos.restaurant_id = p_restaurant_id
    and tos.status = 'terisi'
  union all
  select
    tei.table_number,
    'kosong'::text,
    null::timestamptz,
    null::text,
    tei.id,
    tei.expires_at,
    tei.actor_session_id = v_session.role_session_id
  from public.table_escort_intents tei
  where tei.restaurant_id = p_restaurant_id
    and tei.resolved = false
    and not exists (
      select 1 from public.table_occupancy_state tos2
      where tos2.restaurant_id = tei.restaurant_id
        and tos2.table_number = tei.table_number
        and tos2.status = 'terisi'
    )
  order by table_number;
end;
$$;
revoke all on function public.get_table_occupancy_snapshot(uuid, text) from public, anon, service_role;
grant execute on function public.get_table_occupancy_snapshot(uuid, text) to authenticated;

-- The revision and table rows are read by one SQL statement, so they describe
-- one committed database snapshot even when mutations are concurrent.
create or replace function public.get_table_occupancy_snapshot_versioned(
  p_restaurant_id uuid,
  p_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_result jsonb;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role <> 'ss'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select jsonb_build_object(
    'revision', coalesce(
      (select tor.revision from public.table_occupancy_revisions tor
       where tor.restaurant_id = p_restaurant_id),
      0
    ),
    'tables', coalesce(
      (
        select jsonb_agg(to_jsonb(snapshot_rows) order by snapshot_rows.table_number)
        from (
          select
            tos.table_number,
            tos.status,
            tos.occupied_at,
            tos.occupied_source,
            null::uuid as escort_intent_id,
            null::timestamptz as escort_intent_expires_at,
            false as escort_intent_mine
          from public.table_occupancy_state tos
          where tos.restaurant_id = p_restaurant_id
            and tos.status = 'terisi'
          union all
          select
            tei.table_number,
            'kosong'::text,
            null::timestamptz,
            null::text,
            tei.id,
            tei.expires_at,
            tei.actor_session_id = v_session.role_session_id
          from public.table_escort_intents tei
          where tei.restaurant_id = p_restaurant_id
            and tei.resolved = false
            and not exists (
              select 1 from public.table_occupancy_state tos2
              where tos2.restaurant_id = tei.restaurant_id
                and tos2.table_number = tei.table_number
                and tos2.status = 'terisi'
            )
        ) snapshot_rows
      ),
      '[]'::jsonb
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_table_occupancy_snapshot_versioned(uuid, text) from public, anon, service_role;
grant execute on function public.get_table_occupancy_snapshot_versioned(uuid, text) to authenticated;
