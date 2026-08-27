create table public.owner_retention_scheduler_state (
  scheduler_name text primary key check (scheduler_name = 'owner-retention-daily'),
  mode text not null check (mode in ('pg_cron', 'edge_required')),
  schedule text not null check (schedule = '17 3 * * *'),
  last_success_at timestamptz,
  last_result jsonb,
  updated_at timestamptz not null default now()
);

alter table public.owner_retention_scheduler_state enable row level security;
revoke all on table public.owner_retention_scheduler_state from public, anon, authenticated;

create or replace function public.record_owner_retention_success(p_result jsonb)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_result is null
    or jsonb_typeof(p_result) <> 'object'
    or pg_column_size(p_result) > 4096 then
    raise exception 'OWNER_RETENTION_RESULT_INVALID';
  end if;

  update public.owner_retention_scheduler_state
  set last_success_at = now(),
      last_result = p_result,
      updated_at = now()
  where scheduler_name = 'owner-retention-daily';

  if not found then
    raise exception 'OWNER_RETENTION_SCHEDULER_STATE_MISSING';
  end if;
end;
$$;

create schema if not exists extensions;

do $$
declare
  pgcrypto_schema text;
begin
  select n.nspname into pgcrypto_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    create extension pgcrypto with schema extensions;
  elsif pgcrypto_schema <> 'extensions' then
    alter extension pgcrypto set schema extensions;
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null
    or to_regprocedure('extensions.digest(text,text)') is null
    or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'PGCRYPTO_NAMESPACE_INVALID';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.claim_crew_session(text,text,text,boolean,text)') is not null then
    execute 'revoke all on function public.claim_crew_session(text, text, text, boolean, text) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.claim_crew_session(uuid,text,text,text,boolean,text)') is not null then
    execute 'revoke all on function public.claim_crew_session(uuid, text, text, text, boolean, text) from public, anon, authenticated, service_role';
  end if;
end;
$$;

drop function if exists public.claim_crew_session(text, text, text, boolean, text);
drop function if exists public.claim_crew_session(uuid, text, text, text, boolean, text);

create or replace function public.claim_crew_session(p_restaurant_id uuid, p_tenant_token text, p_display_name text, p_normalized_name text, p_device_description text, p_audio_ready boolean, p_visibility_state text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result public.crew_sessions; v_token text := encode(extensions.gen_random_bytes(32), 'hex'); v_code_version integer;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  select r.code_version into v_code_version from public.restaurant_access_tokens rat join public.restaurants r on r.id = rat.restaurant_id where rat.restaurant_id = p_restaurant_id and rat.token_hash = encode(extensions.digest(p_tenant_token, 'sha256'), 'hex') and rat.expires_at > now() and r.is_active and rat.code_version = r.code_version;
  if v_code_version is null then raise exception 'INVALID_TENANT_SESSION'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40 or p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g'))) then raise exception 'INVALID_NAME'; end if;
  if p_device_description = '' or char_length(p_device_description) > 200 or p_visibility_state not in ('visible', 'hidden') then raise exception 'INVALID_SESSION'; end if;
  update public.crew_sessions set connection_state = 'disconnected', offline_at = now(), updated_at = now() where restaurant_id = p_restaurant_id and connection_state in ('connecting', 'connected') and last_seen <= now() - interval '30 seconds';
  insert into public.crew_sessions (id, restaurant_id, normalized_name, display_name, device_description, audio_ready, visibility_state, connection_state, last_seen, offline_at) values (auth.uid(), p_restaurant_id, p_normalized_name, p_display_name, p_device_description, p_audio_ready, p_visibility_state, case when p_visibility_state = 'visible' then 'connecting' else 'disconnected' end, now(), case when p_visibility_state = 'visible' then null else now() end) on conflict (id) do update set restaurant_id = excluded.restaurant_id, normalized_name = excluded.normalized_name, display_name = excluded.display_name, device_description = excluded.device_description, audio_ready = excluded.audio_ready, visibility_state = excluded.visibility_state, connection_state = excluded.connection_state, last_seen = now(), offline_at = excluded.offline_at, updated_at = now() returning * into result;
  delete from public.crew_session_tokens where crew_session_id = result.id;
  insert into public.crew_session_tokens (token_hash, restaurant_id, crew_session_id, code_version, expires_at) values (encode(extensions.digest(v_token, 'sha256'), 'hex'), p_restaurant_id, result.id, v_code_version, now() + interval '1 hour');
  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;

revoke all on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) from public, anon, service_role;
grant execute on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) to authenticated;

create or replace function public.broadcast_remote_admin_invalidation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, realtime
as $$
begin
  perform realtime.send(
    jsonb_build_object('kind', tg_table_name),
    'invalidate',
    'owner-dashboard',
    false
  );
  return new;
end;
$$;

revoke all on function public.broadcast_remote_admin_invalidation() from public, anon, authenticated;

create or replace function public.cleanup_owner_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  playback_deleted integer;
  errors_deleted integer;
  broadcasts_deleted integer;
  credential_audit_deleted integer;
begin
  delete from public.playback_events where event_timestamp < now() - interval '30 days';
  get diagnostics playback_deleted = row_count;
  delete from public.operational_errors where occurred_at < now() - interval '30 days';
  get diagnostics errors_deleted = row_count;
  delete from public.owner_broadcasts where created_at < now() - interval '30 days';
  get diagnostics broadcasts_deleted = row_count;
  delete from public.restaurant_credential_audit where created_at < now() - interval '90 days';
  get diagnostics credential_audit_deleted = row_count;
  return jsonb_build_object('playback_deleted', playback_deleted, 'errors_deleted', errors_deleted, 'broadcasts_deleted', broadcasts_deleted, 'credential_audit_deleted', credential_audit_deleted);
end;
$$;

revoke all on function public.cleanup_owner_retention() from public, anon, authenticated;
grant execute on function public.cleanup_owner_retention() to service_role;

revoke all on function public.record_owner_retention_success(jsonb) from public, anon, authenticated;
grant execute on function public.record_owner_retention_success(jsonb) to service_role;

create or replace function public.run_owner_retention()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  result := public.cleanup_owner_retention();
  perform public.record_owner_retention_success(result);
  return result;
end;
$$;

revoke all on function public.run_owner_retention() from public, anon, authenticated;
grant execute on function public.run_owner_retention() to service_role;

do $$
declare
  owner_job_count integer;
  exact_job_count integer;
  job record;
begin
  create extension if not exists pg_cron;

  for job in select jobid from cron.job where jobname = 'owner-retention-daily' loop
    perform cron.unschedule(job.jobid);
  end loop;

  perform cron.schedule(
    'owner-retention-daily',
    '17 3 * * *',
    $cron$select public.run_owner_retention()$cron$
  );

  select count(*) into owner_job_count
  from cron.job
  where jobname = 'owner-retention-daily';

  select count(*) into exact_job_count
  from cron.job
  where jobname = 'owner-retention-daily'
    and schedule = '17 3 * * *'
    and command = 'select public.run_owner_retention()';

  if owner_job_count <> 1 or exact_job_count <> 1 then
    raise exception 'OWNER_RETENTION_SCHEDULER_INVALID';
  end if;

  insert into public.owner_retention_scheduler_state (
    scheduler_name, mode, schedule, last_result, updated_at
  ) values (
    'owner-retention-daily',
    'pg_cron',
    '17 3 * * *',
    jsonb_build_object('scheduler', 'pg_cron'),
    now()
  )
  on conflict (scheduler_name) do update set
    mode = excluded.mode,
    schedule = excluded.schedule,
    last_result = excluded.last_result,
    updated_at = excluded.updated_at;
exception
  when insufficient_privilege
    or undefined_file
    or undefined_function
    or invalid_schema_name
    or feature_not_supported
    or object_not_in_prerequisite_state then
    if to_regclass('cron.job') is not null then
      select count(*) into owner_job_count
      from cron.job
      where jobname = 'owner-retention-daily';

      if owner_job_count <> 0 then
        raise exception 'OWNER_RETENTION_SCHEDULER_INVALID';
      end if;
    end if;

    insert into public.owner_retention_scheduler_state (
      scheduler_name, mode, schedule, last_result, updated_at
    ) values (
      'owner-retention-daily',
      'edge_required',
      '17 3 * * *',
      jsonb_build_object('scheduler', 'edge_required', 'sqlstate', sqlstate),
      now()
    )
    on conflict (scheduler_name) do update set
      mode = excluded.mode,
      schedule = excluded.schedule,
      last_result = excluded.last_result,
      updated_at = excluded.updated_at;
end;
$$;
