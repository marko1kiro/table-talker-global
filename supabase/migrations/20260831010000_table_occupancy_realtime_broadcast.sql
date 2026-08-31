-- Fix-up migration for Task 6/9 (table-occupancy-tracking): the design
-- spec's "Realtime Strategy" section requires every mutating RPC that
-- actually changes `table_occupancy_state` to emit a public Realtime
-- Broadcast `invalidate` event on the per-restaurant channel
-- `table-occupancy:{restaurantId}` (no payload beyond a change signal),
-- mirroring the existing `owner-dashboard` broadcast pattern
-- (`realtime.send(payload, event, topic, private)` -- see
-- 20260824007000_audit_database_remediation.sql). Task 6's original RPCs
-- (20260829020000_table_occupancy_rpcs.sql) never added this call, so the
-- Task 9 client hook (`useTableOccupancyRealtime`) had nothing to ever
-- receive on that channel. This migration `create or replace`s the four
-- state-mutating RPCs to add the broadcast, gated by `if found` right
-- after each state-changing statement so idempotent no-op calls (e.g. a
-- redundant QR re-scan of an already-terisi table) never fire a spurious
-- event -- exactly matching the spec's "never on a no-op idempotent QR
-- re-scan" requirement. Function signatures, grants, and all other
-- behavior are unchanged, so no revoke/grant statements are needed here.
--
-- Also adds a daily cleanup for `role_session_tokens`, matching the
-- retention convention already used for its sibling tables
-- `qr_scan_events` (30 days) and `table_escort_intents` (90 days) added in
-- the same Task 5 migration -- role_session_tokens was the one table in
-- that migration left without a sweep, so expired 9-hour bearer tokens
-- would otherwise accumulate without bound.

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
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      false
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
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      false
    );
  end if;
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

  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number),
    'invalidate',
    'table-occupancy:' || v_intent.restaurant_id::text,
    false
  );

  update public.table_escort_intents set resolved = true where id = p_intent_id;
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
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number),
      'invalidate',
      'table-occupancy:' || p_restaurant_id::text,
      false
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention for role_session_tokens: expired 9-hour bearer tokens are
-- inert but were left without a sweep in the Task 5 schema migration,
-- unlike qr_scan_events (30 days) and table_escort_intents (90 days).
-- A short 1-day grace period past expiry (rather than a 30/90-day audit
-- retention) is appropriate here since these rows are session tokens, not
-- audit-trail records -- crew_role_sessions remains the durable audit trail.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_role_session_tokens()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.role_session_tokens where expires_at < now() - interval '1 day';
end;
$$;
revoke all on function public.cleanup_role_session_tokens() from public, anon, authenticated;
grant execute on function public.cleanup_role_session_tokens() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (select 1 from cron.job where jobname = 'cleanup-role-session-tokens-daily') then
    perform cron.schedule(
      'cleanup-role-session-tokens-daily',
      '30 3 * * *',
      $cron$select public.cleanup_role_session_tokens()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function
    or invalid_schema_name or feature_not_supported then null;
end;
$$;
