create or replace function public.owner_dashboard_snapshot()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total_restaurants', (select count(*) from restaurants),
    'active_restaurants', (select count(*) from restaurants where is_active),
    'active_crew_devices', (
      select count(*) from crew_sessions
      where connection_state = 'connected'
        and visibility_state = 'visible'
        and last_seen > now() - interval '30 seconds'
    ),
    'plays_today', (
      select count(*) from playback_events
      where status = 'played' and event_timestamp >= date_trunc('day', now())
    ),
    'sync_failures', (
      select count(*) from operational_errors
      where resolved_at is null and stage in ('sync_cache')
    ),
    'unresolved_errors', (select count(*) from operational_errors where resolved_at is null)
  );
$$;

revoke all on function public.owner_dashboard_snapshot() from public, anon, authenticated;
grant execute on function public.owner_dashboard_snapshot() to service_role;
