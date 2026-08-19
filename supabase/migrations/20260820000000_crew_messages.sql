create table public.crew_messages (
  id uuid primary key default gen_random_uuid(),
  target_session_id uuid not null references public.crew_sessions(id) on delete cascade,
  message text not null check (char_length(message) <= 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index crew_messages_target_idx on public.crew_messages (target_session_id);

create or replace function public.create_crew_message(
  p_target_session_id uuid,
  p_message text,
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
  insert into public.crew_messages (target_session_id, message, expires_at)
  values (p_target_session_id, p_message, now() + make_interval(secs => p_expires_in_seconds))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cleanup_expired_crew_messages()
  returns void
  language sql
  security definer
  set search_path = public as $$
  delete from public.crew_messages where expires_at < now();
$$;

alter table public.crew_messages enable row level security;
revoke all on public.crew_messages from public, anon, authenticated;
revoke all on function public.create_crew_message(uuid, text, bigint),
                public.cleanup_expired_crew_messages() from public, anon, authenticated;
grant execute on function public.create_crew_message(uuid, text, bigint) to service_role;
grant execute on function public.cleanup_expired_crew_messages() to service_role;

do $$
begin
  begin
    alter publication supabase_realtime add table public.crew_messages;
  exception
    when duplicate_object then null;
  end;
end;
$$;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (
    select 1
    from cron.job
    where jobname = 'cleanup-expired-crew-messages-every-minute'
  ) then
    perform cron.schedule(
      'cleanup-expired-crew-messages-every-minute',
      '* * * * *',
      $cron$select public.cleanup_expired_crew_messages()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function or invalid_schema_name
       or feature_not_supported then null;
end;
$$;
