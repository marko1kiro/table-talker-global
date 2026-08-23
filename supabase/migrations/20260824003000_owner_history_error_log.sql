alter table public.operational_errors
  add column if not exists resolution_note text,
  add column if not exists resolved_by text;

alter table public.operational_errors
  drop constraint if exists operational_errors_resolution_note_length;

alter table public.operational_errors
  add constraint operational_errors_resolution_note_length
  check (resolution_note is null or char_length(resolution_note) <= 1000);

create index if not exists operational_errors_owner_filter_idx
  on public.operational_errors (restaurant_id, occurred_at desc);

create index if not exists playback_events_owner_history_idx
  on public.playback_events (restaurant_id, event_timestamp desc);

create index if not exists remote_commands_owner_history_idx
  on public.remote_commands (target_session_id, created_at desc);
