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
  where created_at < now() - interval '30 days';
  get diagnostics playback_deleted = row_count;

  delete from public.operational_errors
  where created_at < now() - interval '30 days';
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

revoke all on function public.cleanup_owner_retention() from public, anon, authenticated;
grant execute on function public.cleanup_owner_retention() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists(select 1 from cron.job where jobname = 'owner-retention-daily') then
    perform cron.schedule(
      'owner-retention-daily',
      '17 3 * * *',
      $cron$select public.cleanup_owner_retention()$cron$
    );
  end if;
exception
  when insufficient_privilege
    or undefined_file
    or undefined_function
    or invalid_schema_name
    or feature_not_supported then null;
end;
$$;
