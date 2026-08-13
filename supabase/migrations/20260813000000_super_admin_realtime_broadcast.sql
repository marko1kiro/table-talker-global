create or replace function public.broadcast_remote_admin_invalidation()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'kind', tg_table_name,
      'sessionId', case when tg_table_name = 'remote_commands' then new.target_session_id else new.id end,
      'commandId', case when tg_table_name = 'remote_commands' then new.id else null end
    ),
    'invalidate',
    'super-admin-remote-audio',
    false
  );
  return new;
end;
$$;

revoke all on function public.broadcast_remote_admin_invalidation() from public, anon, authenticated;

drop trigger if exists crew_sessions_remote_admin_invalidation on public.crew_sessions;
create trigger crew_sessions_remote_admin_invalidation
  after insert or update on public.crew_sessions
  for each row execute function public.broadcast_remote_admin_invalidation();

drop trigger if exists remote_commands_remote_admin_invalidation on public.remote_commands;
create trigger remote_commands_remote_admin_invalidation
  after insert or update on public.remote_commands
  for each row execute function public.broadcast_remote_admin_invalidation();
