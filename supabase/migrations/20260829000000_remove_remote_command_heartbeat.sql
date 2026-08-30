-- Major Update: destructive removal of the remote-command / heartbeat /
-- broadcast-message subsystem. crew_sessions is KEPT but narrowed to
-- identity-only fields; crew_session_tokens, claim_crew_session, and the
-- tenant/credential-rotation RPCs are preserved (redefined without any
-- presence/heartbeat write). Owner Dashboard aggregate/list/detail RPCs are
-- redefined without presence-derived fields. See
-- docs/superpowers/specs/2026-08-29-table-occupancy-tracking-design.md and
-- docs/superpowers/plans/2026-08-29-table-occupancy-tracking.md (Task 2).

-- ---------------------------------------------------------------------------
-- Step 0: stop the pg_cron jobs that target functions being dropped below.
-- ---------------------------------------------------------------------------
do $$
declare
  job record;
begin
  if to_regclass('cron.job') is not null then
    for job in
      select jobid from cron.job
      where jobname in (
        'expire-remote-commands-every-minute',
        'cleanup-remote-commands-daily',
        'cleanup-expired-crew-messages-every-minute'
      )
    loop
      perform cron.unschedule(job.jobid);
    end loop;
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function
    or invalid_schema_name or feature_not_supported then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Step 1: drop dependent RPCs first (order matters for dependency safety).
-- ---------------------------------------------------------------------------
drop function if exists public.expire_remote_commands();
drop function if exists public.cleanup_remote_commands();
drop function if exists public.claim_pending_remote_command(text);
drop function if exists public.ack_remote_command(uuid, text, text, text);
drop function if exists public.create_remote_command(uuid, text, text);
drop function if exists public.heartbeat_crew_session(boolean, text, text, text);
drop function if exists public.create_crew_message(uuid, text, uuid, bigint);
drop function if exists public.cleanup_expired_crew_messages();

-- Dead code (zero application callers, confirmed via repo-wide search):
drop function if exists public.revoke_restaurant_credentials(uuid, integer, text);

-- Entire owner-broadcast RPC surface (drop dependents-of-dependents order).
drop function if exists public.create_owner_broadcast_delivery(uuid, uuid, uuid, uuid, text);
drop function if exists public.record_owner_broadcast_snapshot(uuid, uuid, jsonb);
drop function if exists public.finalize_owner_broadcast(uuid, uuid);
drop function if exists public.create_or_get_owner_broadcast(uuid, text, text, text, uuid, text);
drop function if exists public.check_owner_broadcast_rate_limit(text, integer, integer);

-- ---------------------------------------------------------------------------
-- Step 2: drop tables (FK-safe order: dependents before their parents).
-- ---------------------------------------------------------------------------
drop table if exists public.owner_broadcast_deliveries;
drop table if exists public.owner_broadcast_recipients;
drop table if exists public.owner_broadcast_targets;
drop table if exists public.owner_broadcast_rate_limits;
drop table if exists public.owner_broadcasts;
drop table if exists public.remote_commands;
drop table if exists public.crew_messages;

-- ---------------------------------------------------------------------------
-- Step 3: drop presence-only indexes on crew_sessions, including the
-- online-name-uniqueness partial index. Per the implementation plan's Open
-- Decision (Task 2 Step 2), default resolution (a) is applied: drop the
-- partial uniqueness entirely rather than reinterpreting it as a persistent
-- non-partial unique index, since presence-based dedup (the reason the
-- index existed) no longer exists and the spec never asked for persistent
-- display-name uniqueness outside that context.
-- ---------------------------------------------------------------------------
drop index if exists public.crew_sessions_restaurant_presence_idx;
drop index if exists public.crew_sessions_presence_idx;
drop index if exists public.crew_sessions_online_name_key;

-- ---------------------------------------------------------------------------
-- Step 4: narrow crew_sessions to identity-only fields. crew_sessions
-- itself is KEPT (crew_session_tokens, claim_crew_session,
-- validateCrewAccessInBackground's periodic re-check, and
-- playback-events.server.ts's display_name lookup all still depend on it).
-- ---------------------------------------------------------------------------
alter table public.crew_sessions
  drop column if exists device_description,
  drop column if exists audio_ready,
  drop column if exists visibility_state,
  drop column if exists connection_state,
  drop column if exists last_seen,
  drop column if exists offline_at;

-- ---------------------------------------------------------------------------
-- Step 5: claim_crew_session must be redefined without presence/heartbeat
-- params. This changes the function's signature (7 params -> 4 params), so
-- the old overload is dropped and grants are re-issued explicitly for the
-- new one (create or replace does not carry grants across a signature
-- change). Tenant-token validation preserves the code_version/is_active
-- checks from the live implementation (20260824007000) rather than
-- regressing to a simpler check, since code rotation must still invalidate
-- stale sessions.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_crew_session(uuid, text, text, text, text, boolean, text);

create function public.claim_crew_session(
  p_restaurant_id uuid,
  p_tenant_token text,
  p_display_name text,
  p_normalized_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result public.crew_sessions;
  v_token text := encode(extensions.gen_random_bytes(32), 'hex');
  v_code_version integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  select r.code_version into v_code_version
  from public.restaurant_access_tokens rat
  join public.restaurants r on r.id = rat.restaurant_id
  where rat.restaurant_id = p_restaurant_id
    and rat.token_hash = encode(extensions.digest(p_tenant_token, 'sha256'), 'hex')
    and rat.expires_at > now()
    and r.is_active
    and rat.code_version = r.code_version;
  if v_code_version is null then raise exception 'INVALID_TENANT_SESSION'; end if;

  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
    or p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g')))
  then raise exception 'INVALID_NAME'; end if;

  insert into public.crew_sessions (id, restaurant_id, normalized_name, display_name)
  values (auth.uid(), p_restaurant_id, p_normalized_name, p_display_name)
  on conflict (id) do update set
    restaurant_id = excluded.restaurant_id,
    normalized_name = excluded.normalized_name,
    display_name = excluded.display_name,
    updated_at = now()
  returning * into result;

  delete from public.crew_session_tokens where crew_session_id = result.id;
  insert into public.crew_session_tokens (token_hash, restaurant_id, crew_session_id, code_version, expires_at)
  values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_restaurant_id, result.id, v_code_version, now() + interval '1 hour');

  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;

revoke all on function public.claim_crew_session(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.claim_crew_session(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Step 6: Owner Dashboard aggregate RPC loses active_crew_devices; body
-- otherwise copied verbatim from 20260824001000_owner_dashboard_rpc.sql so
-- unrelated aggregates (plays_today, sync_failures, unresolved_errors) are
-- untouched. Signature is unchanged, so grants carry over automatically;
-- they are restated here for auditability, matching repo convention.
-- ---------------------------------------------------------------------------
create or replace function public.owner_dashboard_snapshot(p_since timestamptz)
returns jsonb
language sql
security definer
set search_path = public
set statement_timeout = '3000ms'
as $$
  with bounds as (
    select greatest(now() - interval '30 days', least(coalesce(p_since, now()), now())) as since
  )
  select jsonb_build_object(
    'total_restaurants', (select count(*) from restaurants),
    'active_restaurants', (select count(*) from restaurants where is_active),
    'plays_today', (
      select count(*) from playback_events
      where status = 'played' and event_timestamp >= date_trunc('day', now())
    ),
    'sync_failures', (
      select count(*) from operational_errors
      where resolved_at is null and occurred_at >= (select since from bounds) and stage = 'sync_cache'
    ),
    'unresolved_errors', (select count(*) from operational_errors where resolved_at is null)
  );
$$;

revoke all on function public.owner_dashboard_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.owner_dashboard_snapshot(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Step 7: owner_restaurant_list() loses the presence-derived online_devices
-- field; every other aggregate (catalog_version, latest_sync_failure,
-- plays_today) is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.owner_restaurant_list()
returns jsonb language sql security definer set search_path = public set statement_timeout = '3000ms' as $$
  select coalesce(jsonb_agg(row_data order by display_name, id), '[]'::jsonb)
  from (
    select r.display_name, r.id, jsonb_build_object(
      'id', r.id, 'display_name', r.display_name, 'is_active', r.is_active,
      'catalog_version', r.catalog_version,
      'latest_sync_failure', (select jsonb_build_object('occurred_at', e.occurred_at, 'report_code', e.report_code) from operational_errors e where e.restaurant_id = r.id and e.stage = 'sync_cache' and e.resolved_at is null order by e.occurred_at desc limit 1),
      'plays_today', (select count(*) from playback_events p where p.restaurant_id = r.id and p.status = 'played' and p.event_timestamp >= date_trunc('day', now() at time zone 'Asia/Jakarta') at time zone 'Asia/Jakarta')
    ) row_data from restaurants r order by r.display_name, r.id limit 100
  ) rows;
$$;

-- ---------------------------------------------------------------------------
-- Step 8: owner_restaurant_detail() drops the presence-derived "devices"
-- block entirely (crew_sessions no longer has device_description,
-- audio_ready, connection_state, visibility_state, last_seen). Every other
-- section (restaurant, catalog, recent_playback, recent_errors,
-- sync_history) is untouched.
-- ---------------------------------------------------------------------------
create or replace function public.owner_restaurant_detail(p_restaurant_id uuid)
returns jsonb language sql security definer set search_path = public set statement_timeout = '3000ms' as $$
  select jsonb_build_object(
    'restaurant', jsonb_build_object('id', r.id, 'display_name', r.display_name, 'is_active', r.is_active, 'catalog_version', r.catalog_version, 'credential_rotated_at', r.credential_rotated_at),
    'catalog', jsonb_build_object('total', (select count(*) from audio_manifests m where m.restaurant_id = r.id and m.catalog_version = r.catalog_version), 'items', catalog.items),
    'recent_playback', playback.items,
    'recent_errors', errors.items,
    'sync_history', sync.items
  ) from restaurants r
  cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('audio_id', m.audio_id, 'label', m.label, 'category', m.category, 'active', m.active, 'ordering', m.ordering) order by m.category, m.ordering), '[]'::jsonb) items from (select audio_id, label, category, active, ordering from audio_manifests where restaurant_id = r.id and catalog_version = r.catalog_version order by category, ordering limit 200) m) catalog
  cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('audio_id', p.audio_id, 'label', p.label, 'event_timestamp', p.event_timestamp, 'crew_name', p.crew_name, 'status', p.status, 'error_detail', p.error_detail) order by p.event_timestamp desc), '[]'::jsonb) items from (select audio_id, label, event_timestamp, crew_name, status, error_detail from playback_events where restaurant_id = r.id order by event_timestamp desc limit 20) p) playback
  cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('stage', e.stage, 'report_code', e.report_code, 'detail', e.detail, 'occurred_at', e.occurred_at, 'resolved_at', e.resolved_at) order by e.occurred_at desc), '[]'::jsonb) items from (select stage, report_code, detail, occurred_at, resolved_at from operational_errors where restaurant_id = r.id order by occurred_at desc limit 20) e) errors
  cross join lateral (select coalesce(jsonb_agg(jsonb_build_object('report_code', e.report_code, 'detail', e.detail, 'occurred_at', e.occurred_at, 'resolved_at', e.resolved_at) order by e.occurred_at desc), '[]'::jsonb) items from (select report_code, detail, occurred_at, resolved_at from operational_errors where restaurant_id = r.id and stage = 'sync_cache' order by occurred_at desc limit 20) e) sync
  where r.id = p_restaurant_id;
$$;

revoke all on function public.owner_restaurant_list() from public, anon, authenticated;
revoke all on function public.owner_restaurant_detail(uuid) from public, anon, authenticated;
grant execute on function public.owner_restaurant_list() to service_role;
grant execute on function public.owner_restaurant_detail(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Step 9: rotate_restaurant_credentials / deactivate_restaurant_credentials
-- are actively called by admin-restaurants.server.ts and must be redefined
-- without the crew_sessions presence-column write (those columns no longer
-- exist). Code rotation/deactivation + audit logging is otherwise
-- unchanged. Signature is unchanged, so grants carry over; revokes are
-- restated for auditability, matching repo convention.
-- ---------------------------------------------------------------------------
create or replace function public.rotate_restaurant_credentials(p_restaurant_id uuid, p_code_hash text, p_code_encrypted text, p_next_code_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set code_hash = p_code_hash, code_encrypted = p_code_encrypted, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
end;
$$;
revoke all on function public.rotate_restaurant_credentials(uuid, text, text, integer) from public, anon, authenticated;

create or replace function public.deactivate_restaurant_credentials(p_restaurant_id uuid, p_next_code_version integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_current_code_version integer;
begin
  select code_version into v_current_code_version from public.restaurants where id = p_restaurant_id for update;
  if v_current_code_version is null then raise exception 'RESTAURANT_NOT_FOUND'; end if;
  if p_next_code_version <= v_current_code_version then raise exception 'INVALID_CODE_VERSION'; end if;
  update public.restaurants set is_active = false, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;
  delete from public.restaurant_access_tokens where restaurant_id = p_restaurant_id;
  delete from public.crew_session_tokens where restaurant_id = p_restaurant_id;
end;
$$;
revoke all on function public.deactivate_restaurant_credentials(uuid, integer) from public, anon, authenticated;

grant execute on function public.rotate_restaurant_credentials(uuid, text, text, integer), public.deactivate_restaurant_credentials(uuid, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Step 10: cleanup_owner_retention() loses the owner_broadcasts delete
-- (table is gone); every other retained-data delete (playback_events,
-- operational_errors, restaurant_credential_audit) is untouched, including
-- the credential_audit_deleted diagnostic.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_owner_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  playback_deleted integer;
  errors_deleted integer;
  credential_audit_deleted integer;
begin
  delete from public.playback_events where event_timestamp < now() - interval '30 days';
  get diagnostics playback_deleted = row_count;
  delete from public.operational_errors where occurred_at < now() - interval '30 days';
  get diagnostics errors_deleted = row_count;
  delete from public.restaurant_credential_audit where created_at < now() - interval '90 days';
  get diagnostics credential_audit_deleted = row_count;
  return jsonb_build_object('playback_deleted', playback_deleted, 'errors_deleted', errors_deleted, 'credential_audit_deleted', credential_audit_deleted);
end;
$$;

revoke all on function public.cleanup_owner_retention() from public, anon, authenticated;
grant execute on function public.cleanup_owner_retention() to service_role;
