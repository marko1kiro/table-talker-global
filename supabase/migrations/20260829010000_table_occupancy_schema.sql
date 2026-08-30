-- Additive schema for the table-occupancy-tracking Major Update (Task 5).
--
-- Adds five new, restaurant-scoped, RLS-locked tables backing the 2-state
-- (kosong/terisi) table occupancy machine, the QR Interceptor scan log, the
-- Satgas escort-intent pattern, and manual role-session audit trails for the
-- 4 field crew roles (SS/Kasir/Satgas/Clear Up). All five tables revoke
-- direct client privileges: mutations happen only through the RPC surface
-- added in Task 6, never via direct PostgREST table access.
--
-- Purely additive: nothing removed/changed here touches the
-- remote-command/heartbeat/broadcast subsystem removed in Task 1-4, nor the
-- existing crew_sessions identity core, audio catalog, or owner dashboard.

-- ---------------------------------------------------------------------------
-- table_occupancy_state: the 2-state machine itself, one row per table per
-- restaurant. status transitions between 'kosong' and 'terisi' only via
-- RPCs (Task 6); occupied_source records what triggered the last
-- kosong->terisi transition for audit purposes.
-- ---------------------------------------------------------------------------
create table public.table_occupancy_state (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  status text not null default 'kosong' check (status in ('kosong', 'terisi')),
  occupied_at timestamptz,
  occupied_source text check (occupied_source in ('qr_scan', 'kasir', 'satgas_escort')),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, table_number)
);
alter table public.table_occupancy_state enable row level security;
revoke all on public.table_occupancy_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- qr_scan_events: append-only audit log of every QR-Interceptor scan,
-- fail-open/non-blocking by design (the interceptor never blocks the
-- customer's redirect to the ESB ordering flow on a logging failure).
-- ---------------------------------------------------------------------------
create table public.qr_scan_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  scanned_at timestamptz not null default now()
);
create index qr_scan_events_restaurant_time_idx on public.qr_scan_events (restaurant_id, scanned_at);
alter table public.qr_scan_events enable row level security;
revoke all on public.qr_scan_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- table_escort_intents: Satgas's "I am escorting a guest to this table"
-- intent, actor-scoped and auto-expiring after 30 minutes (enforced by
-- callers checking expires_at; resolved is set true once the escort
-- completes or the intent is superseded).
-- ---------------------------------------------------------------------------
create table public.table_escort_intents (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  actor_session_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved boolean not null default false
);
create index table_escort_intents_actor_idx on public.table_escort_intents (actor_session_id, resolved);
alter table public.table_escort_intents enable row level security;
revoke all on public.table_escort_intents from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- crew_role_sessions: manual Nama+JamMasuk audit trail for all 4 field
-- roles (including SS, for Manager Dashboard symmetry per the design
-- spec's Open Decision 1 -- SS additionally keeps its existing, narrowed
-- crew_sessions row for identity/token/audio-access purposes; this table is
-- purely an additive audit log, not a replacement for crew_sessions).
-- ---------------------------------------------------------------------------
create table public.crew_role_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role text not null check (role in ('ss', 'kasir', 'satgas', 'clear_up')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  checked_in_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index crew_role_sessions_restaurant_role_idx
  on public.crew_role_sessions (restaurant_id, role, checked_in_at);
alter table public.crew_role_sessions enable row level security;
revoke all on public.crew_role_sessions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- role_session_tokens: opaque, SHA-256-hashed bearer tokens binding a
-- browser session to a crew_role_sessions row, following the same
-- hashed-token convention as restaurant_access_tokens/crew_session_tokens.
-- ---------------------------------------------------------------------------
create table public.role_session_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role_session_id uuid not null references public.crew_role_sessions (id) on delete cascade,
  role text not null check (role in ('ss', 'kasir', 'satgas', 'clear_up')),
  expires_at timestamptz not null
);
create index role_session_tokens_session_idx on public.role_session_tokens (role_session_id, expires_at);
alter table public.role_session_tokens enable row level security;
revoke all on public.role_session_tokens from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Retention: qr_scan_events (30 days) and table_escort_intents (90 days),
-- following the existing cleanup_owner_retention()/
-- cleanup_restaurant_credential_audit() convention. Scheduling follows the
-- documented pg_cron-if-available, else edge_required pattern (see
-- docs/supabase-super-admin-remote-audio.md); the `do $$ ... exception ...`
-- guard below mirrors every other scheduling block in this migration
-- history so Supabase Hobby-tier deployments (no pg_cron) still succeed.
-- ---------------------------------------------------------------------------
create or replace function public.cleanup_qr_scan_events()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.qr_scan_events where scanned_at < now() - interval '30 days';
end;
$$;
revoke all on function public.cleanup_qr_scan_events() from public, anon, authenticated;
grant execute on function public.cleanup_qr_scan_events() to service_role;

create or replace function public.cleanup_table_escort_intents()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.table_escort_intents where expires_at < now() - interval '90 days';
end;
$$;
revoke all on function public.cleanup_table_escort_intents() from public, anon, authenticated;
grant execute on function public.cleanup_table_escort_intents() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (select 1 from cron.job where jobname = 'cleanup-qr-scan-events-daily') then
    perform cron.schedule(
      'cleanup-qr-scan-events-daily',
      '20 3 * * *',
      $cron$select public.cleanup_qr_scan_events()$cron$
    );
  end if;
  if not exists (select 1 from cron.job where jobname = 'cleanup-table-escort-intents-daily') then
    perform cron.schedule(
      'cleanup-table-escort-intents-daily',
      '25 3 * * *',
      $cron$select public.cleanup_table_escort_intents()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function
    or invalid_schema_name or feature_not_supported then null;
end;
$$;

-- ---------------------------------------------------------------------------
-- esb_app_id: nullable per-restaurant mapping to the ESB ordering system's
-- APP/{id} URL segment (e.g. https://esborder.qs.esb.co.id/APP/1294/order),
-- needed by the QR Interceptor (Task 7). Populated manually per restaurant,
-- the same way credentials are provisioned today; format/value to be
-- confirmed with ops before Task 7 (Open Decision 3).
-- ---------------------------------------------------------------------------
alter table public.restaurants add column if not exists esb_app_id text;
