-- H-04 remediation (audit table-talker-global, Fase 2, 2026-09-02): closes
-- the "intent escort duplikat" finding. create_escort_intent previously let
-- any number of concurrent unresolved intents pile up against the same
-- (restaurant_id, table_number) -- a second Satgas device (or a double-tap
-- on the same device after a dropped response) could always insert another
-- row, and nothing on the server ever told a second device "someone is
-- already escorting this table". The client-side workaround
-- (satgas-escort-waitlist.ts, Task 11) only ever solved this for a single
-- browser tab's own sessionStorage -- a different role_session_id (a
-- second phone, or the same phone after a fresh Satgas login) never saw
-- it.
--
-- Fix, in three parts:
--
-- 1. A partial unique index enforces *at the data layer* that a
--    (restaurant_id, table_number) pair can have at most one unresolved
--    escort intent at a time -- the actual bug, not just a symptom.
--    create_escort_intent is re-created to check for an existing
--    unresolved intent first (row-locked, so two truly concurrent calls
--    still serialize correctly): a retry by the *same* actor_session_id is
--    idempotent (returns the existing intent id, so a double-tap or a
--    dropped-response retry never errors); a different actor gets a new
--    'ALREADY_ESCORTED' error. The unique index is kept as the final
--    backstop for the race between the check and the insert (caught via a
--    `when unique_violation` handler), since row locks only apply to rows
--    that already exist -- two truly simultaneous first-time inserts for
--    the same table can still both pass the "not found" check.
--
-- 2. Because (1) means a table can never get a *new* escort intent while
--    an old, unresolved one for it still exists, every RPC that can also
--    transition a table straight to 'terisi' by a path *other than*
--    confirm_escort_intent (set_table_occupied_kasir via the Kasir role,
--    record_qr_scan via the QR Interceptor) must resolve any pending
--    escort intent for that table the moment it does so -- otherwise a
--    guest seated by a QR scan or by Kasir while a Satgas escort was still
--    pending would permanently orphan that row and lock out all future
--    escorts for the table. set_table_empty_cleanup gets the same resolve
--    as defense-in-depth (a table should never re-enter 'kosong' with a
--    stale unresolved intent still attached to it).
--
-- 3. get_table_occupancy_snapshot -- the one RPC every Satgas device
--    actually polls/subscribes to -- now also surfaces each KOSONG
--    table's active escort intent (id, expiry, and whether *this* caller
--    is the one who created it), so a second Satgas device can see "this
--    table already has an escort in progress" from the server, not just
--    from another device's local sessionStorage. This is additive to the
--    existing terisi-rows-only response shape from
--    20260831214101_optimize_table_occupancy_snapshot.sql. A `not exists`
--    guard excludes any table that is (or briefly still looks, on old
--    pre-migration data -- see the cleanup below) both terisi and
--    intent-bearing, so the UNION ALL can never emit two rows for the same
--    table_number.
--
-- Function signatures, grants, and validation logic not described above
-- are unchanged from their prior definitions.

-- Pre-migration data cleanup, required before the unique index below can
-- be created: collapses any duplicate unresolved intents already sitting
-- on the same table (exactly the bug this migration fixes -- production
-- may already have more than one) down to the single newest row, and
-- resolves any unresolved intent whose table already became terisi via a
-- path other than confirm_escort_intent before this migration existed.
update public.table_escort_intents tei
set resolved = true
where resolved = false
  and (
    exists (
      select 1 from public.table_occupancy_state tos
      where tos.restaurant_id = tei.restaurant_id
        and tos.table_number = tei.table_number
        and tos.status = 'terisi'
    )
    or exists (
      select 1 from public.table_escort_intents newer
      where newer.restaurant_id = tei.restaurant_id
        and newer.table_number = tei.table_number
        and newer.resolved = false
        and (newer.created_at, newer.id) > (tei.created_at, tei.id)
    )
  );

create unique index table_escort_intents_one_active_per_table_idx
  on public.table_escort_intents (restaurant_id, table_number)
  where resolved = false;

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
begin
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id
    and role = 'satgas'
    and expires_at > now();
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
      -- Idempotent retry (double-tap, or a dropped response being
      -- retried) by the same Satgas session that already holds the
      -- active intent for this table -- never error, just hand back the
      -- same intent id.
      return v_existing.id;
    else
      raise exception 'ALREADY_ESCORTED';
    end if;
  end if;

  begin
    insert into public.table_escort_intents (restaurant_id, table_number, actor_session_id, expires_at)
    values (p_restaurant_id, p_table_number, v_session.role_session_id, now() + interval '10 minutes')
    returning id into v_id;
    return v_id;
  exception
    when unique_violation then
      -- Two calls raced past the "not found" check above simultaneously;
      -- the unique index let exactly one insert through. Resolve the
      -- same way the pre-check above would have.
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
end;
$$;
revoke all on function public.create_escort_intent(uuid, integer, text) from public, anon, service_role;
grant execute on function public.create_escort_intent(uuid, integer, text) to authenticated;

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
begin
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id
    and role = 'kasir'
    and expires_at > now();
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
    -- H-04 part 2: a table seated by Kasir while a Satgas escort was
    -- still pending must not leave that intent orphaned -- see migration
    -- header.
    update public.table_escort_intents
    set resolved = true
    where restaurant_id = p_restaurant_id
      and table_number = p_table_number
      and resolved = false;

    perform realtime.send(
      jsonb_build_object('table_number', p_table_number),
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
begin
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id
    and role = 'clear_up'
    and expires_at > now();
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
    -- H-04 defense-in-depth: a table should never re-enter 'kosong' with
    -- a stale unresolved intent still attached to it (see migration
    -- header) -- this should normally already be a no-op by the time
    -- Clear Up runs, since (2) resolves intents at the point a table
    -- becomes terisi in the first place.
    update public.table_escort_intents
    set resolved = true
    where restaurant_id = p_restaurant_id
      and table_number = p_table_number
      and resolved = false;

    perform realtime.send(
      jsonb_build_object('table_number', p_table_number),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      false
    );
  end if;
end;
$$;
revoke all on function public.set_table_empty_cleanup(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_empty_cleanup(uuid, integer, text) to authenticated;

create or replace function public.record_qr_scan(
  p_restaurant_id uuid,
  p_table_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id) then
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
    -- H-04 part 2: a table seated by a customer's own QR scan while a
    -- Satgas escort was still pending must not leave that intent
    -- orphaned -- see migration header.
    update public.table_escort_intents
    set resolved = true
    where restaurant_id = p_restaurant_id
      and table_number = p_table_number
      and resolved = false;

    perform realtime.send(
      jsonb_build_object('table_number', p_table_number),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      false
    );
  end if;
end;
$$;
revoke all on function public.record_qr_scan(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_qr_scan(uuid, integer) to service_role;

-- get_table_occupancy_snapshot's returns table(...) column list is
-- growing three columns to carry escort-intent visibility (H-04 part 3).
-- Postgres does not allow CREATE OR REPLACE FUNCTION to change a
-- function's return type -- which includes its RETURNS TABLE column list
-- -- only its body, so the old definition must be dropped first, unlike
-- every other function in this migration. The revoke/grant pair
-- immediately below re-establishes the authenticated-only surface within
-- the same migration transaction (a freshly created function otherwise
-- defaults to EXECUTE granted to PUBLIC).
drop function if exists public.get_table_occupancy_snapshot(uuid, text);

create function public.get_table_occupancy_snapshot(
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
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id
    and role <> 'ss'
    and expires_at > now();
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
