create extension if not exists pgcrypto;

create table public.crew_sessions (
  id uuid primary key,
  normalized_name text not null,
  display_name text not null check (char_length(display_name) between 1 and 40),
  device_description text not null check (char_length(device_description) between 1 and 200),
  audio_ready boolean not null default false,
  visibility_state text not null check (visibility_state in ('visible', 'hidden')),
  connection_state text not null check (connection_state in ('connected', 'disconnected')),
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  offline_at timestamptz
);

create unique index crew_sessions_online_name_key
  on public.crew_sessions (normalized_name)
  where connection_state = 'connected';

create table public.remote_commands (
  id uuid primary key default gen_random_uuid(),
  target_session_id uuid not null references public.crew_sessions(id) on delete cascade,
  audio_id text not null check (audio_id ~ '^(table:([1-9]|[1-6][0-9]|70)|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto))$'),
  actor text not null check (actor = 'super-admin'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'sent' check (status in ('sent', 'played', 'failed', 'expired')),
  acknowledged_at timestamptz,
  failure_reason text check (char_length(failure_reason) <= 160),
  check (expires_at = created_at + interval '5 seconds'),
  check ((status = 'failed') = (failure_reason is not null)),
  check ((status in ('played', 'failed')) = (acknowledged_at is not null))
);

create index remote_commands_target_created_at_idx on public.remote_commands (target_session_id, created_at desc);
create index remote_commands_created_at_idx on public.remote_commands (created_at);
create index remote_commands_sent_expires_at_idx on public.remote_commands (expires_at) where status = 'sent';

create or replace function public.claim_crew_session(
  p_display_name text,
  p_normalized_name text,
  p_device_description text,
  p_audio_ready boolean,
  p_visibility_state text
)
returns public.crew_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40 then raise exception 'INVALID_NAME'; end if;
  if p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g'))) then raise exception 'INVALID_NAME'; end if;
  if p_device_description = '' or char_length(p_device_description) > 200 then raise exception 'INVALID_DEVICE'; end if;
  if p_visibility_state not in ('visible', 'hidden') then raise exception 'INVALID_VISIBILITY'; end if;

  update public.crew_sessions
  set connection_state = 'disconnected', offline_at = now(), updated_at = now()
  where connection_state = 'connected' and last_seen <= now() - interval '30 seconds';

  insert into public.crew_sessions (
    id, normalized_name, display_name, device_description, audio_ready, visibility_state,
    connection_state, last_seen, offline_at
  )
  values (
    auth.uid(), p_normalized_name, p_display_name, p_device_description, p_audio_ready,
    p_visibility_state, case when p_visibility_state = 'visible' then 'connected' else 'disconnected' end,
    now(), case when p_visibility_state = 'visible' then null else now() end
  )
  on conflict (id) do update
  set normalized_name = excluded.normalized_name,
      display_name = excluded.display_name,
      device_description = excluded.device_description,
      audio_ready = excluded.audio_ready,
      visibility_state = excluded.visibility_state,
      connection_state = excluded.connection_state,
      last_seen = now(),
      offline_at = excluded.offline_at,
      updated_at = now()
  returning * into result;
  return result;
end;
$$;

create or replace function public.heartbeat_crew_session(
  p_audio_ready boolean,
  p_visibility_state text,
  p_connection_state text
)
returns public.crew_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.crew_sessions;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_visibility_state not in ('visible', 'hidden') or p_connection_state not in ('connected', 'disconnected') then raise exception 'INVALID_PRESENCE'; end if;

  update public.crew_sessions
  set audio_ready = p_audio_ready,
      visibility_state = p_visibility_state,
      connection_state = case when p_visibility_state = 'visible' then p_connection_state else 'disconnected' end,
      last_seen = now(),
      offline_at = case when p_visibility_state = 'visible' and p_connection_state = 'connected' then null else now() end,
      updated_at = now()
  where id = auth.uid()
  returning * into result;
  if result.id is null then raise exception 'SESSION_NOT_FOUND'; end if;
  return result;
end;
$$;

create or replace function public.ack_remote_command(
  p_command_id uuid,
  p_status text,
  p_failure_reason text default null
)
returns public.remote_commands
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.remote_commands;
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_status not in ('played', 'failed') then raise exception 'INVALID_STATUS'; end if;

  update public.remote_commands
  set status = p_status,
      acknowledged_at = now(),
      failure_reason = case when p_status = 'failed' then left(coalesce(nullif(p_failure_reason, ''), 'Pemutaran audio gagal.'), 160) else null end
  where id = p_command_id
    and target_session_id = auth.uid()
    and status = 'sent'
    and expires_at > now()
  returning * into result;
  if result.id is null then raise exception 'COMMAND_NOT_ACKNOWLEDGEABLE'; end if;
  return result;
end;
$$;

create or replace function public.expire_remote_commands()
returns integer
language sql
security definer
set search_path = public
as $$
  with changed as (
    update public.remote_commands set status = 'expired'
    where status = 'sent' and expires_at <= now()
    returning 1
  ) select count(*)::integer from changed;
$$;

create or replace function public.cleanup_remote_commands()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.remote_commands where created_at < now() - interval '7 days'
    returning 1
  ) select count(*)::integer from deleted;
$$;

alter table public.crew_sessions enable row level security;
alter table public.remote_commands enable row level security;
revoke all on public.crew_sessions, public.remote_commands from anon, authenticated;
revoke all on function public.claim_crew_session(text, text, text, boolean, text), public.heartbeat_crew_session(boolean, text, text), public.ack_remote_command(uuid, text, text), public.expire_remote_commands(), public.cleanup_remote_commands() from public, anon, authenticated;
grant execute on function public.claim_crew_session(text, text, text, boolean, text), public.heartbeat_crew_session(boolean, text, text), public.ack_remote_command(uuid, text, text) to authenticated;
grant execute on function public.expire_remote_commands(), public.cleanup_remote_commands() to service_role;
grant select on public.crew_sessions, public.remote_commands to authenticated;
create policy "crew reads own session" on public.crew_sessions for select to authenticated using (id = auth.uid());
create policy "crew reads targeted commands" on public.remote_commands for select to authenticated using (target_session_id = auth.uid());

do $$
begin
  begin
    alter publication supabase_realtime add table public.crew_sessions;
  exception
    when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.remote_commands;
  exception
    when duplicate_object then null;
  end;
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (select 1 from cron.job where jobname = 'expire-remote-commands-every-minute') then
    perform cron.schedule('expire-remote-commands-every-minute', '* * * * *', $cron$select public.expire_remote_commands()$cron$);
  end if;
  if not exists (select 1 from cron.job where jobname = 'cleanup-remote-commands-daily') then
    perform cron.schedule('cleanup-remote-commands-daily', '17 3 * * *', $cron$select public.cleanup_remote_commands()$cron$);
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function or invalid_schema_name or feature_not_supported then null;
end;
$$;
