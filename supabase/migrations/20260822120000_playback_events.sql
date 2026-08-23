create table public.playback_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid
    constraint playback_events_restaurant_id_fkey
    references public.restaurants (id) on delete cascade,
  audio_id text not null,
  label text not null,
  event_timestamp timestamptz not null,
  crew_name text not null,
  crew_session_id text not null,
  device_id text not null,
  status text not null check (status in ('played', 'failed')),
  error_detail text,
  created_at timestamptz not null default now()
);

create index playback_events_restaurant_ts_idx
  on public.playback_events (restaurant_id, event_timestamp desc);

create index playback_events_restaurant_audio_idx
  on public.playback_events (restaurant_id, audio_id);

alter table public.playback_events enable row level security;
revoke all on public.playback_events from anon, authenticated;

-- Batch ingestion via RPC (service-role)
-- Read via admin API (service-role)
-- No direct anon/authenticated access
