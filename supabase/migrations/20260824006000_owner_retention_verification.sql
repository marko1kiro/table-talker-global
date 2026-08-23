create or replace function public.cleanup_owner_retention()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  playback_deleted integer;
  errors_deleted integer;
  broadcasts_deleted integer;
begin
  delete from public.playback_events
  where event_timestamp < now() - interval '30 days';
  get diagnostics playback_deleted = row_count;

  delete from public.operational_errors
  where occurred_at < now() - interval '30 days';
  get diagnostics errors_deleted = row_count;

  delete from public.owner_broadcasts
  where created_at < now() - interval '30 days';
  get diagnostics broadcasts_deleted = row_count;

  return jsonb_build_object(
    'playback_deleted', playback_deleted,
    'errors_deleted', errors_deleted,
    'broadcasts_deleted', broadcasts_deleted
  );
end;
$$;

do $$
begin
  if not exists(
    select 1 from cron.job
    where jobname = 'owner-retention-daily'
      and schedule = '17 3 * * *'
      and command = 'select public.cleanup_owner_retention()'
  ) then
    raise exception 'OWNER_RETENTION_SCHEDULER_MISSING';
  end if;
exception
  when undefined_table or invalid_schema_name then
    raise exception 'OWNER_RETENTION_SCHEDULER_MISSING';
end;
$$;
