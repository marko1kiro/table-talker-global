create index if not exists operational_errors_unresolved_stage_occurred_idx
  on public.operational_errors (stage, occurred_at desc)
  where resolved_at is null;

create index if not exists playback_events_status_timestamp_idx
  on public.playback_events (status, event_timestamp desc);

create index if not exists crew_sessions_presence_idx
  on public.crew_sessions (connection_state, visibility_state, last_seen desc);

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
      where resolved_at is null and occurred_at >= (select since from bounds) and stage = 'sync_cache'
    ),
    'unresolved_errors', (select count(*) from operational_errors where resolved_at is null)
  );
$$;

revoke all on function public.owner_dashboard_snapshot(timestamptz) from public, anon, authenticated;
grant execute on function public.owner_dashboard_snapshot(timestamptz) to service_role;
