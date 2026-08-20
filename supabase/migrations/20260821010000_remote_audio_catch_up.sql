create or replace function public.claim_pending_remote_command()
returns public.remote_commands
language sql
stable
security definer
set search_path = public
as $$
  select command
  from public.remote_commands command
  where command.target_session_id = auth.uid()
    and command.status = 'sent'
    and command.expires_at > now()
  order by command.created_at desc, command.id desc
  limit 1;
$$;

revoke all on function public.claim_pending_remote_command() from public, anon;
grant execute on function public.claim_pending_remote_command() to authenticated;
