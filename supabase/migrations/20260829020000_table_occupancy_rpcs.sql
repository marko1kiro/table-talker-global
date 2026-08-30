-- RPC Surface for the table-occupancy-tracking Major Update (Task 6).
--
-- All mutations to the five Task-5 tables happen exclusively through these
-- RPCs; no client-facing grants exist on the tables themselves (verified in
-- Task 5's migration and re-verified here for restaurant_access_tokens,
-- which this migration reads from but never grants).
--
-- Token expiry: role_session_tokens issued by claim_role_session use a
-- 9-hour expiry, matching the standard field-crew shift length (confirmed
-- with the user; this deliberately differs from crew_sessions/
-- crew_session_tokens's existing 1-hour SS token, which serves a different,
-- higher-churn identity/playback-session purpose untouched by this Major
-- Update).
--
-- get_table_occupancy_snapshot: uses a generate_series(1,100) left join
-- against table_occupancy_state rather than backfilling 100 rows per
-- restaurant at provisioning time (Open Decision, resolved this task per
-- user confirmation) -- simpler, no new provisioning-time step, and the
-- 100-row scan has negligible cost.

-- ---------------------------------------------------------------------------
-- claim_role_session: field-role analogue of claim_crew_session. Validates
-- the tenant token (restaurant_access_tokens, same pattern as every other
-- tenant-scoped RPC in this codebase), validates role + display_name,
-- inserts an audit-trail crew_role_sessions row with the *manually entered*
-- checked_in_at (never overwritten by now()), and issues an opaque,
-- SHA-256-hashed bearer token via role_session_tokens.
-- ---------------------------------------------------------------------------
create or replace function public.claim_role_session(
  p_restaurant_id uuid,
  p_tenant_token text,
  p_role text,
  p_display_name text,
  p_checked_in_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_role_sessions;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_role not in ('ss', 'kasir', 'satgas', 'clear_up') then raise exception 'INVALID_ROLE'; end if;

  if not exists (
    select 1
    from public.restaurant_access_tokens rat
    join public.restaurants r on r.id = rat.restaurant_id
    where rat.restaurant_id = p_restaurant_id
      and rat.token_hash = encode(extensions.digest(p_tenant_token, 'sha256'), 'hex')
      and rat.expires_at > now()
      and r.is_active
      and rat.code_version = r.code_version
  ) then raise exception 'INVALID_TENANT_SESSION'; end if;

  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
  then raise exception 'INVALID_NAME'; end if;

  if p_checked_in_at is null then raise exception 'INVALID_CHECKED_IN_AT'; end if;

  insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at)
  values (p_restaurant_id, p_role, p_display_name, p_checked_in_at)
  returning * into result;

  insert into public.role_session_tokens (token_hash, restaurant_id, role_session_id, role, expires_at)
  values (
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    p_restaurant_id,
    result.id,
    p_role,
    now() + interval '9 hours'
  );

  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
revoke all on function public.claim_role_session(uuid, text, text, text, timestamptz) from public, anon, service_role;
grant execute on function public.claim_role_session(uuid, text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- set_table_occupied_kasir: Kasir-only kosong -> terisi transition.
-- Idempotent via the `where ... status = 'kosong'` guard: a second Kasir tap
-- on an already-terisi table is a silent no-op (matches the spec's
-- idempotency requirement generalized beyond just QR scans).
-- ---------------------------------------------------------------------------
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
end;
$$;
revoke all on function public.set_table_occupied_kasir(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_occupied_kasir(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_table_empty_cleanup: Clear Up-only terisi -> kosong transition,
-- mirroring set_table_occupied_kasir but in the opposite direction and
-- clearing occupied_at/occupied_source. Idempotent via the
-- `where ... status = 'terisi'` guard.
-- ---------------------------------------------------------------------------
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
end;
$$;
revoke all on function public.set_table_empty_cleanup(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_empty_cleanup(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- create_escort_intent: Satgas-only staging record for "I am escorting a
-- guest to this table". actor_session_id is bound server-side to the
-- caller's verified role_session_id -- never accepted from the client --
-- and expires_at is fixed at 30 minutes from now, per the design spec's
-- escort-intent lifecycle (a QR scan arriving within that window resolves
-- occupancy through record_qr_scan instead; this intent then simply expires
-- unconfirmed and is swept by cleanup_table_escort_intents, no manual
-- cancel exists).
-- ---------------------------------------------------------------------------
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

  insert into public.table_escort_intents (restaurant_id, table_number, actor_session_id, expires_at)
  values (p_restaurant_id, p_table_number, v_session.role_session_id, now() + interval '30 minutes')
  returning id into v_id;

  return v_id;
end;
$$;
revoke all on function public.create_escort_intent(uuid, integer, text) from public, anon, service_role;
grant execute on function public.create_escort_intent(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- confirm_escort_intent: Satgas-only fallback confirmation, callable ONLY
-- after the 30-minute window has elapsed with no QR scan (expires_at <=
-- now()), only by the same Satgas role session that created the intent
-- (actor_session_id match), and only while the target table is still
-- kosong (if a QR scan already claimed it first, this raises
-- ALREADY_OCCUPIED rather than silently overwriting occupied_source).
-- Success transitions the table to terisi with occupied_source =
-- 'satgas_escort' and marks the intent resolved.
-- ---------------------------------------------------------------------------
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
begin
  select * into v_session
  from public.role_session_tokens
  where token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and role = 'satgas'
    and expires_at > now();
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
end;
$$;
revoke all on function public.confirm_escort_intent(uuid, text) from public, anon, service_role;
grant execute on function public.confirm_escort_intent(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- record_qr_scan: service-role-only (no authenticated grant at all).
-- Called exclusively from the QR Interceptor's server-side redirect handler
-- (Task 7), never directly from the browser. Always inserts a
-- qr_scan_events row regardless of resulting state change (every scan is a
-- legitimate low-cost signal worth logging, even redundant re-scans of an
-- already-terisi table). Idempotent on table_occupancy_state via the
-- `where ... status = 'kosong'` guard. This RPC itself still raises real
-- exceptions on invalid input; fail-open/non-blocking behavior is the
-- responsibility of the calling interceptor code, not this RPC.
-- ---------------------------------------------------------------------------
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
end;
$$;
revoke all on function public.record_qr_scan(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_qr_scan(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- get_table_occupancy_snapshot: read-only RPC returning all 100 table rows
-- for a restaurant, defaulting any table_number with no
-- table_occupancy_state row to 'kosong' via a generate_series(1,100) left
-- join (decision: no provisioning-time backfill needed -- see migration
-- header). Callable by any valid, non-expired role session EXCEPT 'ss'
-- (SS has no occupancy UI per the design spec).
-- ---------------------------------------------------------------------------
create or replace function public.get_table_occupancy_snapshot(
  p_restaurant_id uuid,
  p_session_token text
)
returns table (
  table_number integer,
  status text,
  occupied_at timestamptz,
  occupied_source text
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
    gs.table_number,
    coalesce(tos.status, 'kosong'),
    tos.occupied_at,
    tos.occupied_source
  from generate_series(1, 100) as gs(table_number)
  left join public.table_occupancy_state tos
    on tos.restaurant_id = p_restaurant_id
    and tos.table_number = gs.table_number
  order by gs.table_number;
end;
$$;
revoke all on function public.get_table_occupancy_snapshot(uuid, text) from public, anon, service_role;
grant execute on function public.get_table_occupancy_snapshot(uuid, text) to authenticated;
