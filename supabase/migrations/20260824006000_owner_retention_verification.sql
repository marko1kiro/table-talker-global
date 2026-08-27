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
declare
  owner_job_count integer;
  exact_job_count integer;
begin
  if to_regclass('cron.job') is not null then
    select count(*) into owner_job_count
    from cron.job
    where jobname = 'owner-retention-daily';

    select count(*) into exact_job_count
    from cron.job
    where jobname = 'owner-retention-daily'
      and schedule = '17 3 * * *'
      and command = 'select public.cleanup_owner_retention()';

    if owner_job_count <> 1 or exact_job_count <> 1 then
      raise exception 'OWNER_RETENTION_SCHEDULER_INVALID';
    end if;
  end if;
end;
$$;
