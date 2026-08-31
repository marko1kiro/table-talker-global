# Table Occupancy Tracking (and Remote-Command/Heartbeat Removal) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (A) Destructively remove the remote-command/heartbeat/broadcast-message
subsystem (no longer needed, always-on per-device cost). (B) Add a 2-state
table-occupancy tracking system (KOSONG/TERISI) for up to 100 tables per
restaurant, driven primarily by a QR Interceptor redirect service, with
manual corrections from three new roles (Kasir, Satgas, Clear Up) and a
revised, role-aware crew login flow shared by all four roles including SS.

**Design reference:** `docs/superpowers/specs/2026-08-29-table-occupancy-tracking-design.md`
(read before starting; this plan implements that spec exactly — do not
invent scope beyond it).

**Architecture:** TanStack Start server functions + Supabase Postgres
(`security definer` RPCs, RLS revoke-by-default, opaque hashed session
tokens) + Realtime Broadcast `invalidate` channels (no Postgres Changes, no
heartbeat). QR Interceptor is a small standalone redirect endpoint
(fail-open, non-blocking log write, 302 to the real ESB order URL). Kasir/
Satgas/Clear Up UIs reuse `OwnerUi.tsx` (clean theme); SS keeps its
neo-brutalist theme and route, only its login dialog changes.

**Tech Stack:** TypeScript, TanStack Start, React 19, Zod, Supabase/
PostgreSQL SQL migrations and RPCs (`security definer`, `set search_path =
public`, `auth.uid()`-gated, named exceptions), Supabase Realtime Broadcast,
Vitest, `OwnerUi.tsx` component library, `window.localStorage` (layout
prefs), Asia/Jakarta manual datetime input.

**Ordering principle:** Removal tasks (1–4) run before additive tasks (5+).
Deleting the heartbeat/remote-command/broadcast-message code and schema
first means the new login flow and role UIs are built directly against the
final, narrowed `crew_sessions` shape — never against fields that are about
to disappear.

---

## Dependency Order

1. Tasks 1–4 (removal) have no dependency on the new feature and can land
   as an isolated, independently deployable change.
2. Task 5 (additive schema) depends on Task 1's narrowed `crew_sessions`
   shape (the new `crew_role_sessions` table and its RPCs reference it).
3. Task 6 (RPC surface) depends on Task 5's tables existing.
4. Task 7 (QR Interceptor route) depends on Task 6's `record_qr_scan` RPC.
5. Task 8 (login flow rework) depends on Task 5/6 (role-session claim RPC)
   and must land before Tasks 9–11 (role UIs need the new login to reach
   them).
6. Tasks 9, 10, 11 (Kasir, Satgas, Clear Up UIs) can proceed in parallel
   once Task 8 lands; each depends only on Task 6's RPCs and Task 12's
   realtime channel helper.
7. Task 12 (realtime broadcast helper) is shared infrastructure for 9–11;
   build it once, before or alongside the first role UI.
8. Task 13 (Manager Dashboard data-contract verification) is a read-only
   validation step, not a UI build — confirms Phase 1 schema needs no
   later breaking change. No route ships.
9. Task 14 (regression, full-repo grep sweep, `npm run verify`) runs last.

## File Map

### Removed (Task 1–4)

- Delete: `src/hooks/use-remote-crew.ts`
- Delete: `src/hooks/use-crew-message.ts`
- Delete: `src/components/CrewMessageOverlay.tsx`
- Delete: `src/routes/super-admin/broadcast.tsx`
- Delete: `src/lib/owner-broadcast.server.ts`
- Delete: `src/lib/owner-broadcast-domain.ts`
- Delete: `src/lib/owner-broadcast-idempotency.server.ts`
- Delete: `src/lib/owner-broadcast-retry.ts`
- Delete: `tests/use-remote-crew.test.ts`, `tests/remote-audio-hook.test.ts`,
  `tests/remote-commands-restaurant-id.test.ts`,
  `tests/owner-broadcast-domain.test.ts`,
  `tests/owner-broadcast-idempotency.test.ts`,
  `tests/owner-broadcast-retry.test.ts`, `tests/owner-broadcast-source.test.ts`,
  `tests/crew-message-integration.test.ts`,
  `tests/crew-messages-restaurant-id.test.ts`
- Create: `supabase/migrations/20260829000000_remove_remote_command_heartbeat.sql`
  — drops `remote_commands`, `crew_messages`, their RPCs, and the presence
  columns on `crew_sessions`.
- Modify: `src/routes/index.tsx` — remove `useRemoteCrew`/`useCrewMessage`
  wiring, `onCrewSessionId`/`playRemoteAudio` remote path, `CrewMessageOverlay`
  render, `audioReady` plumbing that only existed for heartbeat payloads.
- Modify: `src/components/CrewIdentityDialog.tsx` — superseded entirely by
  Task 8's new login flow component(s); this file's `unlockAudio`-only
  concern is preserved but the dialog markup/flow is replaced.
- Modify: `src/lib/crew-session-identity.ts` — drop `audioReady` from
  `CrewSessionIdentity` if it was only meaningful for heartbeat payloads
  (verify against Task 8's new identity shape before removing).
- Modify: `src/routes/super-admin/route.tsx` — remove the "Broadcast" nav
  entry.
- Modify: `src/routes/super-admin/index.tsx` — remove the "Crew Online"
  metric card and its `active_crew_devices` reference.
- Modify: `src/lib/owner-dashboard.server.ts`,
  `src/lib/owner-dashboard-domain.ts` — remove `active_crew_devices` field
  from `OwnerDashboardAggregates` and its aggregation.
- Modify: `supabase/migrations/20260824001000_owner_dashboard_rpc.sql`
  equivalent — new migration `20260829000000_remove_remote_command_heartbeat.sql`
  also replaces `owner_dashboard_snapshot`/aggregate RPC to drop
  `active_crew_devices` (do not edit historical migration files; add a new
  migration that alters the function).
- Modify: `src/routes/super-admin/restaurants/$id.tsx` — remove the
  online-device/presence display block.
- Modify: `src/lib/playback-events.server.ts` — verify it only reads
  `crew_sessions.display_name`/`id` (already true per spec research); no
  change expected, add a regression test asserting it still works against
  the narrowed table.

### Added (Task 5+)

- Create: `supabase/migrations/20260829010000_table_occupancy_schema.sql`
  — `table_occupancy_state`, `qr_scan_events`, `table_escort_intents`,
  `crew_role_sessions`, `role_session_tokens` (session-token table for the
  new roles, mirroring `crew_session_tokens`), indexes, RLS, retention
  cleanup functions.
- Create: `supabase/migrations/20260829020000_table_occupancy_rpcs.sql`
  — `claim_role_session`, `set_table_occupied_kasir`,
  `set_table_empty_cleanup`, `create_escort_intent`, `confirm_escort_intent`,
  `record_qr_scan`, `get_table_occupancy_snapshot` (read RPC for role UIs).
- Create: `src/lib/table-occupancy-domain.ts` — `TableOccupancyStatus` type
  (distinct from `TableStatus` in `TableButton.tsx`), state-machine guard
  functions, table-number validation (1–100), duration-formatting helper
  for Clear Up's client-side sort.
- Create: `src/lib/role-session-domain.ts` — role enum
  (`"ss" | "kasir" | "satgas" | "clear_up"`), manual name validation
  (reuse `normalizeCrewName`-style rules), manual `checked_in_at` validation
  (must parse as a valid Asia/Jakarta datetime, reasonable bounds e.g. not
  more than 24h in the past/future — exact bound decided in Task 8).
- Create: `src/lib/table-occupancy.server.ts` — server fns wrapping the new
  RPCs (`getTableOccupancySnapshot`, `setTableOccupiedKasir`,
  `setTableEmptyCleanup`, `createEscortIntent`, `confirmEscortIntent`),
  session-token verification analogous to `restaurant-session.server.ts`.
- Create: `src/lib/role-session.server.ts` — `claimRoleSession` server fn,
  role-session-token verification helper (`verifyRoleSessionToken`).
- Create: `src/lib/qr-interceptor.server.ts` — `resolveEsbRedirectUrl`,
  `recordQrScan` (calls `record_qr_scan` RPC, fire-and-forget with bounded
  timeout, never throws to the caller).
- Create: `src/routes/api/qr/$restaurantSlug/$tableNumber.ts` (or dedicated
  redirect route, exact path finalized in Task 7) — the interceptor
  endpoint: parse params, resolve ESB URL, log scan, 302 redirect.
- Create: `src/components/RoleLoginFlow.tsx` (replaces
  `CrewIdentityDialog.tsx` usage) — multi-step dialog: code entry → identity
  confirmation → role picker → name/time form.
- Create: `src/lib/use-layout-preference.ts` — `localStorage`-backed
  grid/list preference hook, per-role-scoped key.
- Create: `src/hooks/use-table-occupancy-realtime.ts` — subscribes to
  `table-occupancy:{restaurantId}` broadcast channel, rate-limited refetch,
  polling fallback; no heartbeat, no presence.
- Create: `src/routes/kasir/index.tsx` — Kasir grid/list UI.
- Create: `src/routes/satgas/index.tsx` — Satgas grid/list UI + escort
  intent flow.
- Create: `src/routes/clear-up/index.tsx` — Clear Up list UI with
  client-side duration sort.
- Modify: `src/routes/index.tsx` — wire in the new `RoleLoginFlow` for SS,
  keep the rest of the soundboard page unchanged.
- Modify: `restaurants` table — add nullable `esb_app_id text` column
  (Open Decision 3 in the spec; confirm value format before writing this
  migration — see Task 6).
- Create: `tests/table-occupancy-domain.test.ts`,
  `tests/role-session-domain.test.ts`, `tests/qr-interceptor.test.ts`,
  `tests/table-occupancy-rpc-contract.test.ts` (migration/schema contract
  tests, following the style of `tests/restaurant-code-migration.test.ts`),
  `tests/role-login-flow.test.ts`, `tests/kasir-route.test.ts`,
  `tests/satgas-route.test.ts`, `tests/clear-up-route.test.ts`.

---

## Task 1: Red Tests For Removal (lock down what must disappear)

**Files:**
- Create: `tests/removal-contract.test.ts`

- [x] **Step 1: Write failing "must not exist" contract tests**

```ts
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const removedFiles = [
  "src/hooks/use-remote-crew.ts",
  "src/hooks/use-crew-message.ts",
  "src/components/CrewMessageOverlay.tsx",
  "src/routes/super-admin/broadcast.tsx",
  "src/lib/owner-broadcast.server.ts",
  "src/lib/owner-broadcast-domain.ts",
  "src/lib/owner-broadcast-idempotency.server.ts",
  "src/lib/owner-broadcast-retry.ts",
];

it("removed heartbeat/remote-command/broadcast files no longer exist", () => {
  for (const file of removedFiles) expect(existsSync(file)).toBe(false);
});

it("no remaining source references removed RPCs/tables", () => {
  const banned = [
    "heartbeat_crew_session",
    "create_remote_command",
    "ack_remote_command",
    "claim_pending_remote_command",
    "remote_commands",
    "crew_messages",
    "owner-broadcast",
  ];
  // Implementation scans src/ (excluding this test and migrations, which
  // legitimately reference the terms for the drop statements) for each
  // banned token and asserts zero matches.
});
```

- [x] **Step 2: Run red test** — `npm test -- tests/removal-contract.test.ts`.
  Expected: FAIL (files still exist, tokens still referenced).

### Task 2: Database Removal Migration

**Files:**
- Create: `supabase/migrations/20260829000000_remove_remote_command_heartbeat.sql`

- [x] **Step 1: Write the destructive migration**

```sql
-- Drop dependent RPCs first (order matters for FK/dependency safety).
drop function if exists public.expire_remote_commands();
drop function if exists public.cleanup_remote_commands();
drop function if exists public.claim_pending_remote_command(text);
drop function if exists public.ack_remote_command(uuid, text, text, text);
drop function if exists public.create_remote_command(uuid, text, text);
drop function if exists public.heartbeat_crew_session(boolean, text, text, text);

drop table if exists public.remote_commands;
drop table if exists public.crew_messages;

-- Narrow crew_sessions to identity-only fields.
alter table public.crew_sessions
  drop column if exists device_description,
  drop column if exists audio_ready,
  drop column if exists visibility_state,
  drop column if exists connection_state,
  drop column if exists last_seen,
  drop column if exists offline_at;

-- claim_crew_session must be redefined without presence/heartbeat params.
drop function if exists public.claim_crew_session(uuid, text, text, text, text, boolean, text);
create or replace function public.claim_crew_session(
  p_restaurant_id uuid, p_tenant_token text, p_display_name text, p_normalized_name text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.crew_sessions; v_token text := encode(gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if not exists (
    select 1 from public.restaurant_access_tokens rat
    join public.restaurants r on r.id = rat.restaurant_id
    where rat.restaurant_id = p_restaurant_id
      and rat.token_hash = encode(digest(p_tenant_token, 'sha256'), 'hex')
      and rat.expires_at > now() and r.is_active
  ) then raise exception 'INVALID_TENANT_SESSION'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
     or p_normalized_name <> lower(trim(regexp_replace(p_display_name, '\s+', ' ', 'g')))
  then raise exception 'INVALID_NAME'; end if;
  insert into public.crew_sessions (id, restaurant_id, normalized_name, display_name)
  values (auth.uid(), p_restaurant_id, p_normalized_name, p_display_name)
  on conflict (id) do update set
    restaurant_id = excluded.restaurant_id,
    normalized_name = excluded.normalized_name,
    display_name = excluded.display_name,
    updated_at = now()
  returning * into result;
  delete from public.crew_session_tokens where crew_session_id = result.id;
  insert into public.crew_session_tokens (token_hash, restaurant_id, crew_session_id, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), p_restaurant_id, result.id, now() + interval '1 hour');
  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
revoke all on function public.claim_crew_session(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.claim_crew_session(uuid, text, text, text) to authenticated;

-- Dashboard aggregate RPC loses active_crew_devices; redefine without it
-- (exact prior body copied from 20260824001000_owner_dashboard_rpc.sql
-- minus the removed field — implementer reads that file before writing
-- this replacement to avoid dropping unrelated aggregates).
```

- [x] **Step 2: Verify the unique-name-while-online index is gone or
  reinterpreted.** `crew_sessions_online_name_key` was a partial index on
  `connection_state in ('connecting','connected')`; that column no longer
  exists. Decide and implement one of: (a) drop the partial uniqueness
  entirely (multiple devices may share a display name — acceptable since
  presence-based dedup was the whole point of that index and presence is
  gone), or (b) keep a plain non-partial unique index on `normalized_name`
  scoped to `restaurant_id` if duplicate-name prevention within a
  restaurant is still wanted. Confirm with user before choosing (default
  to (a) — drop it — unless told otherwise, since the spec never asked for
  persistent name-uniqueness outside the presence context).
- [x] **Step 3: Run migration locally/staging**: `npx supabase db push`
  (or project's established migration command) and confirm no errors.
- [x] **Step 4: Write `tests/removal-migration.test.ts`** asserting (via
  reading the migration file's SQL text, matching the style of
  `tests/restaurant-code-migration.test.ts`) that it drops the listed
  tables/functions/columns and does not touch unrelated tables
  (`audio_manifests`, `owner_history`, `operational_errors`, etc.).

### Task 3: Frontend/Server Removal

**Files:** all "Removed" entries in File Map above.

- [x] **Step 1: Delete hook/component/route/server-lib files** listed in
  the File Map's Removed section.
- [x] **Step 2: Update `src/routes/index.tsx`** — remove
  `useRemoteCrew`/`useCrewMessage` imports and usage, the
  `CrewMessageOverlay` render, `onCrewSessionId` remote-triggered playback
  path. Keep `playRemoteAudio`'s *local* announcement/table playback intact
  if any of that logic is shared with local `play()` — verify no dead code
  remains after removing the remote path (this file's remote-specific
  branches are the only thing removed; local cache-based playback via
  `play()` is untouched).
- [x] **Step 3: Update `src/routes/super-admin/route.tsx`** — remove the
  Broadcast nav link.
- [x] **Step 4: Update `src/routes/super-admin/index.tsx`** — remove the
  "Crew Online" metric card from the `metrics` array; dashboard grid goes
  from 6 to 5 items (verify the responsive `xl:grid-cols-3 2xl:grid-cols-6`
  className still reads well at 5 items, adjust if needed).
- [x] **Step 5: Update `src/lib/owner-dashboard.server.ts` /
  `owner-dashboard-domain.ts`** — drop `active_crew_devices` from
  `OwnerDashboardAggregates` type and its RPC call site.
- [x] **Step 6: Update `src/routes/super-admin/restaurants/$id.tsx`** —
  remove the presence/online-device display block; verify the rest of the
  detail page (catalog mappings, tenant buttons, history) is unaffected.
- [x] **Step 7: Delete the ~9 obsolete test files** listed in File Map.
- [x] **Step 8: Run `tests/removal-contract.test.ts`** from Task 1 — must
  now pass (green).
- [x] **Step 9: Run full suite** `npm test`, `npm run typecheck`,
  `npm run lint` — fix any fallout (unused imports, dangling types) before
  proceeding. Do not leave broken builds between removal and addition.

### Task 4: Removal Verification Checkpoint

- [x] **Step 1:** `npm run verify` passes fully with the subsystem gone and
  nothing else regressed. This is a hard gate — additive work (Task 5+)
  must not start on a red baseline.
- [x] **Step 2:** Manually confirm (via a quick local run or code read) that
  SS login → soundboard → play table audio → play announcement all still
  work using only local Cache Storage playback, with zero calls to any
  removed RPC.
- [x] **Step 3:** Commit removal as one focused commit/PR increment before
  starting additive schema work (keeps the destructive change reviewable
  in isolation).

---

## Task 5: Additive Schema — Occupancy, Escort Intent, Role Sessions

**Files:**
- Create: `supabase/migrations/20260829010000_table_occupancy_schema.sql`
- Create: `tests/table-occupancy-migration.test.ts`

- [x] **Step 1: Write failing schema-contract test** (style of
  `tests/restaurant-code-migration.test.ts`) asserting the migration file
  creates `table_occupancy_state`, `qr_scan_events`, `table_escort_intents`,
  `crew_role_sessions`, `role_session_tokens`, each `restaurant_id`-scoped,
  RLS-enabled, and `revoke all ... from public, anon, authenticated` at
  table level (no direct client access, mutations only via RPC — Task 6).

- [x] **Step 2: Write the migration**

```sql
create table public.table_occupancy_state (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  status text not null default 'kosong' check (status in ('kosong', 'terisi')),
  occupied_at timestamptz,
  occupied_source text check (occupied_source in ('qr_scan', 'kasir', 'satgas_escort')),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, table_number)
);
alter table public.table_occupancy_state enable row level security;
revoke all on public.table_occupancy_state from public, anon, authenticated;

create table public.qr_scan_events (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  scanned_at timestamptz not null default now()
);
create index qr_scan_events_restaurant_time_idx on public.qr_scan_events (restaurant_id, scanned_at);
alter table public.qr_scan_events enable row level security;
revoke all on public.qr_scan_events from public, anon, authenticated;

create table public.table_escort_intents (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  actor_session_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  resolved boolean not null default false
);
create index table_escort_intents_actor_idx on public.table_escort_intents (actor_session_id, resolved);
alter table public.table_escort_intents enable row level security;
revoke all on public.table_escort_intents from public, anon, authenticated;

create table public.crew_role_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role text not null check (role in ('ss', 'kasir', 'satgas', 'clear_up')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  checked_in_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index crew_role_sessions_restaurant_role_idx on public.crew_role_sessions (restaurant_id, role, checked_in_at);
alter table public.crew_role_sessions enable row level security;
revoke all on public.crew_role_sessions from public, anon, authenticated;

create table public.role_session_tokens (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role_session_id uuid not null references public.crew_role_sessions(id) on delete cascade,
  role text not null check (role in ('ss', 'kasir', 'satgas', 'clear_up')),
  expires_at timestamptz not null
);
create index role_session_tokens_session_idx on public.role_session_tokens (role_session_id, expires_at);
alter table public.role_session_tokens enable row level security;
revoke all on public.role_session_tokens from public, anon, authenticated;

-- Retention: qr_scan_events and table_escort_intents follow the existing
-- 30/90-day sweep convention. Add cleanup functions mirroring
-- cleanup_restaurant_credential_audit()/cleanup_owner_retention() style —
-- implementer wires scheduler per docs/supabase-super-admin-remote-audio.md
-- conventions (pg_cron if available, else edge_required documented mode).
create or replace function public.cleanup_qr_scan_events()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.qr_scan_events where scanned_at < now() - interval '30 days';
end;
$$;
revoke all on function public.cleanup_qr_scan_events() from public, anon, authenticated;

create or replace function public.cleanup_table_escort_intents()
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.table_escort_intents where expires_at < now() - interval '90 days';
end;
$$;
revoke all on function public.cleanup_table_escort_intents() from public, anon, authenticated;
```

- [x] **Step 3: Add `esb_app_id` column** (Open Decision 3 resolved — confirm
  exact format with user/ops before writing; default nullable text):

```sql
alter table public.restaurants add column if not exists esb_app_id text;
```

- [x] **Step 4: Run migration, run schema-contract test — must pass (green).**

## Task 6: RPC Surface

**Files:**
- Create: `supabase/migrations/20260829020000_table_occupancy_rpcs.sql`
- Create: `src/lib/table-occupancy.server.ts`
- Create: `src/lib/role-session.server.ts`
- Create: `tests/table-occupancy-rpc-contract.test.ts`

- [x] **Step 1: Write failing RPC-contract tests** (schema-text assertions
  per existing migration-test convention) asserting every RPC below exists,
  is `security definer`, `set search_path = public`, and revokes execute
  from `public`/`anon` while granting only to the appropriate role
  (`authenticated` for client-callable RPCs, no grant at all for
  `record_qr_scan` which is service-role-only).

- [x] **Step 2: Write `claim_role_session` RPC**

```sql
create or replace function public.claim_role_session(
  p_restaurant_id uuid, p_tenant_token text, p_role text,
  p_display_name text, p_checked_in_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare result public.crew_role_sessions; v_token text := encode(gen_random_bytes(32), 'hex');
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;
  if p_role not in ('ss', 'kasir', 'satgas', 'clear_up') then raise exception 'INVALID_ROLE'; end if;
  if not exists (
    select 1 from public.restaurant_access_tokens rat
    join public.restaurants r on r.id = rat.restaurant_id
    where rat.restaurant_id = p_restaurant_id
      and rat.token_hash = encode(digest(p_tenant_token, 'sha256'), 'hex')
      and rat.expires_at > now() and r.is_active
  ) then raise exception 'INVALID_TENANT_SESSION'; end if;
  if p_display_name !~ '^[[:print:]]+$' or char_length(p_display_name) not between 1 and 40
  then raise exception 'INVALID_NAME'; end if;
  insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at)
  values (p_restaurant_id, p_role, p_display_name, p_checked_in_at)
  returning * into result;
  insert into public.role_session_tokens (token_hash, restaurant_id, role_session_id, role, expires_at)
  values (encode(digest(v_token, 'sha256'), 'hex'), p_restaurant_id, result.id, p_role, now() + interval '12 hours');
  return jsonb_build_object('session', to_jsonb(result), 'session_token', v_token);
end;
$$;
revoke all on function public.claim_role_session(uuid, text, text, text, timestamptz) from public, anon, service_role;
grant execute on function public.claim_role_session(uuid, text, text, text, timestamptz) to authenticated;
```

  Note the `12 hours` token expiry (vs. SS's `1 hour`): field roles work
  full shifts without necessarily re-triggering realtime reconnects the way
  SS's playback-session model does; exact expiry is a judgment call — flag
  for confirmation, default to matching a typical shift length rather than
  copying SS's 1-hour value verbatim.

- [x] **Step 3: Write `set_table_occupied_kasir`**

```sql
create or replace function public.set_table_occupied_kasir(
  p_restaurant_id uuid, p_table_number integer, p_session_token text
) returns void language plpgsql security definer set search_path = public as $$
declare v_session record;
begin
  select * into v_session from public.role_session_tokens
  where token_hash = encode(digest(p_session_token, 'sha256'), 'hex')
    and restaurant_id = p_restaurant_id and role = 'kasir' and expires_at > now();
  if v_session is null then raise exception 'INVALID_SESSION'; end if;
  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;
  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'kasir')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi', occupied_at = now(), occupied_source = 'kasir', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';
  perform pg_notify('table_occupancy_changed', p_restaurant_id::text); -- or Realtime broadcast call, see Task 12
end;
$$;
revoke all on function public.set_table_occupied_kasir(uuid, integer, text) from public, anon, service_role;
grant execute on function public.set_table_occupied_kasir(uuid, integer, text) to authenticated;
```

  The `where ... status = 'kosong'` guard makes this idempotent-safe (a
  second Kasir tap on an already-`terisi` table is a silent no-op, matching
  the spec's idempotency requirement generalized beyond just QR scans).

- [x] **Step 4: Write `set_table_empty_cleanup`** — mirrors Step 3 but
  role-checks `'clear_up'`, transitions `terisi → kosong`, clears
  `occupied_at`/`occupied_source`, guarded by `where status = 'terisi'`.

- [x] **Step 5: Write `create_escort_intent`** — role-checks `'satgas'`,
  inserts into `table_escort_intents` with `expires_at = now() + interval
  '30 minutes'`, `actor_session_id` bound to the caller's verified role
  session id (never client-supplied).

- [x] **Step 6: Write `confirm_escort_intent`** — role-checks `'satgas'`,
  verifies `actor_session_id` in the target intent row matches the caller's
  session id, verifies `expires_at <= now()` (only confirmable after
  expiry, per spec) and `resolved = false`, verifies the target table is
  still `kosong` (if a QR scan already claimed it, this RPC must raise
  `ALREADY_OCCUPIED` rather than overwrite `occupied_source`), then
  transitions the table to `terisi` with `occupied_source = 'satgas_escort'`
  and marks the intent `resolved = true`.

- [x] **Step 7: Write `record_qr_scan`** — **no `authenticated` grant at
  all**; callable only via service-role client from the interceptor server
  code (Task 7). Idempotent no-op if already `terisi`; always inserts a
  `qr_scan_events` row regardless (the append-only log records every scan,
  even ones that don't change state, since re-scans are a legitimate
  low-cost signal worth keeping for now — revisit retention cost only if it
  becomes material). Fails silently at the SQL level is not acceptable
  (that would hide bugs) — instead, the *calling server code* in Task 7
  wraps this RPC call so failures never block the redirect, while the RPC
  itself still raises real exceptions for genuinely invalid input.

- [x] **Step 8: Write `get_table_occupancy_snapshot`** — read RPC (or plain
  `select` through a narrow view) returning all 100 rows for a restaurant
  (defaulting missing table numbers to `kosong` — either backfilled at
  restaurant-provisioning time or computed via a `generate_series(1,100)`
  left join in the RPC, decide during implementation and document the
  choice in this file once made). Callable by any authenticated role-session
  holder for that restaurant (SS excluded — SS has no occupancy UI).

- [x] **Step 9: Server wrappers** — `src/lib/table-occupancy.server.ts` and
  `src/lib/role-session.server.ts`, `createServerFn` + Zod validators +
  try/catch returning discriminated-union results, no leaking of raw
  Postgres error text to the client — same *shape* as
  `restaurants.server.ts`/`restaurant-session.server.ts`, but with one
  correction to the client-construction step below.

  **⚠️ Correction to this step's original wording (found and resolved
  during implementation, 2026-08-30):** the text above originally said
  "service-role Supabase client" for both files. That is only true for
  `record_qr_scan`. The other six RPCs
  (`claim_role_session`, `set_table_occupied_kasir`,
  `set_table_empty_cleanup`, `create_escort_intent`,
  `confirm_escort_intent`, `get_table_occupancy_snapshot`) are all
  `revoke ... from ... service_role` / `grant execute ... to authenticated`
  in `supabase/migrations/20260829020000_table_occupancy_rpcs.sql`, and
  `claim_role_session`'s body additionally hard-fails with `UNAUTHORIZED`
  whenever `auth.uid() is null` — which a service-role JWT always is. A
  service-role client can never call these six successfully in production.
  This matches the design spec's own RPC Surface table
  (`docs/superpowers/specs/2026-08-29-table-occupancy-tracking-design.md`),
  which already documents these as "authenticated (post-QR-login anonymous
  auth)" — the plan text was simply out of sync with the spec.

  **Implemented resolution** (confirmed with the user before coding):
  - `role-session.server.ts` exports `getAnonAuthedSupabaseClient(accessToken)`:
    builds a **per-request** Supabase client using the public anon key
    (`process.env.VITE_SUPABASE_URL` / `process.env.VITE_SUPABASE_ANON_KEY`
    — these are plain OS-level env vars readable via `process.env` in
    server code exactly like `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
    in `remote-audio.server.ts`; the Vite `define`-based
    `import.meta.env` injection is a *separate*, client-bundle-only
    mechanism and irrelevant here) plus an `Authorization: Bearer
    <accessToken>` header. `claimRoleSession` and the five analogous
    `table-occupancy.server.ts` wrappers (`setTableOccupiedKasir`,
    `setTableEmptyCleanup`, `createEscortIntent`, `confirmEscortIntent`,
    `getTableOccupancySnapshot`) all take a new required `accessToken`
    input field and call this per-request client's `.rpc(...)` instead of
    the service client.
  - **Scope note for Task 8**: this means Task 8 must obtain an
    anonymous-auth Supabase session (`signInAnonymously()`, same mechanism
    already used for SS today) for **all four roles**, not just SS, and
    pass that session's access token into these server functions. Small
    addition to Task 8's original scope — see its Step 2 note below.
  - `verifyRoleSessionToken` (in `role-session.server.ts`, mirroring
    `verifyActiveTenantSession`/`verifyCrewSessionToken` in
    `restaurant-session.server.ts`) still uses the plain
    `getServiceClient()` service-role client and queries the
    `role_session_tokens` table directly (no RPC call). This remains valid
    and unaffected by the grant mismatch above: Task 5's schema migration
    only revokes **table**-level access from `public, anon, authenticated`
    — it never revokes `service_role`, and the revoke this step is working
    around is strictly on **function EXECUTE** privileges, not table
    `SELECT`.
  - `recordQrScan` (in `table-occupancy.server.ts`, used by Task 7) is
    unaffected by any of the above and correctly uses the plain
    `getServiceClient()` service-role client with no `accessToken`
    parameter — `record_qr_scan` really is `grant execute ... to
    service_role` in the migration, the sole RPC of the seven for which
    the original "service-role Supabase client" wording was accurate.

- [x] **Step 10: Run RPC-contract tests — must pass (green).** (Unaffected
  by Step 9 — that test file only asserts against the migration SQL text,
  not against these wrapper files.)

## Task 7: QR Interceptor

**Files:**
- Create: `src/lib/qr-interceptor.server.ts`
- Create: `src/routes/r/$restaurantId/t/$tableNumber.ts` (route shape
  finalized as `/r/{restaurantId}/t/{tableNumber}`, matching the spec's
  confirmed `qr.xdirga.xyz/r/{restaurant}/t/{table}` shape one-to-one once
  a domain is pointed at this deployment)
- Create: `tests/qr-interceptor.test.ts`

- [x] **Step 1: Write failing tests** covering: (a) valid restaurant+table
  → 302 to the correct ESB URL using `esb_app_id`; (b) unknown restaurant
  slug → safe fallback (decide: 404, or redirect to a generic "resto tidak
  ditemukan" page — never leak internal error detail); (c) logging failure
  (mocked DB error) still produces the 302 (fail-open contract); (d)
  repeated calls for an already-`terisi` table still redirect correctly and
  do not throw. Implemented as 18 tests in `tests/qr-interceptor.test.ts`,
  covering the above plus: inactive restaurant, missing `esb_app_id`,
  malformed restaurant-id/table-number params, a bounded scan-timeout
  case, and a source-contract check that this module reuses
  `recordQrScanCore` and the service-role client (never the anon+Bearer
  client from Task 6 Step 9's other five wrappers).

- [x] **Step 2: Implement `resolveEsbRedirectUrl(restaurantId, tableNumber)`**
  — looks up `restaurants.esb_app_id`, builds
  `https://esborder.qs.esb.co.id/APP/{esb_app_id}/order?mode=dinein&tableNumber={tableNumber}`.
  Returns `null`/error variant if `esb_app_id` is missing or restaurant
  inactive — caller decides fallback behavior (Step 1b). Implemented as a
  pure, dependency-injected core function taking a `RestaurantEsbLookup`
  callback (mirrors the Core-fn pattern from `owner-dashboard.server.ts`),
  with three distinct failure codes (`RESTAURANT_NOT_FOUND`,
  `RESTAURANT_INACTIVE`, `MISSING_ESB_APP_ID`) so the caller can decide
  fallback behavior per case; any lookup exception is folded into
  `RESTAURANT_NOT_FOUND` so no raw error ever surfaces.

- [x] **Step 3: Implement `recordQrScan(restaurantId, tableNumber)`** —
  calls `record_qr_scan` RPC via service-role client with a bounded
  timeout (e.g. `Promise.race` against a short timer); any rejection is
  caught and swallowed (logged to `operational_errors` if feasible without
  blocking, but never rethrown). **Task 6 Step 9 note:** this is exactly
  `recordQrScan` already exported from `src/lib/table-occupancy.server.ts`
  (built in Task 6) — reuse it directly rather than re-implementing the
  RPC call here; it is the one Task 6 wrapper genuinely built on the plain
  service-role client, since `record_qr_scan` alone is `grant execute ...
  to service_role` in the migration. **Implementation note:** reuses
  `recordQrScanCore` (the pure core, not the `createServerFn`-wrapped
  `recordQrScan`) directly against a locally-constructed service-role
  client, wrapped in `defaultRecordQrScan` and awaited via
  `Promise.race` against a 1500ms timer in `recordScanBestEffort` — any
  rejection or timeout is swallowed, the 302 always proceeds.

- [x] **Step 4: Implement the route handler** — resolve params → resolve
  redirect URL → fire `recordQrScan` without `await`-blocking the response
  beyond its bounded budget → issue `302` via TanStack Start's server
  response API. Confirm with the TanStack Start routing docs/existing
  `src/routes/api/audio/$audioId.ts` pattern for how this codebase already
  implements a raw API route, and follow the same convention. Implemented
  at `src/routes/r/$restaurantId/t/$tableNumber.ts` following that exact
  `createFileRoute(...).server.handlers.GET` convention. **Judgment call
  flagged:** the plan's original file path used `$restaurantSlug`, but no
  `slug` column exists anywhere in the `restaurants` schema (only `id`,
  `code_hash`/`code_encrypted` — explicitly "never a public slug, URL
  identifier" per `docs/superpowers/specs/2026-08-23-restaurant-code-login-design.md`
  — `display_name`, `esb_app_id`, etc.). The route param is the
  restaurant's UUID `id` instead; physical QR codes must encode that UUID.
  This should be confirmed with the user/ops before printing real QR
  codes.

- [x] **Step 5: Decide and document final domain/hosting** — resolves Open
  Decision 2 from the spec (temporary `qr.xdirga.xyz` vs. final domain).
  Not blocking for building the route itself; the route works under any
  domain pointed at this deployment. **Left open, not decided in this
  session** — flagged back to the user per the plan's own "not blocking"
  guidance; the route itself is domain-agnostic and ready for either
  `qr.xdirga.xyz` or a final domain once chosen.

- [x] **Step 6: Run tests — must pass (green).** 18/18 new tests green;
  full suite 408/408 green (69 test files); `tsc --noEmit` clean; `eslint`
  clean on all new/modified files (pre-existing unrelated debt in
  `scripts/provision-restaurants-and-audio.mjs` untouched); `vite build`
  succeeded, new route confirmed registered in `src/routeTree.gen.ts` as
  `/r/$restaurantId/t/$tableNumber` and bundled into the SSR output.
  `check:edge` still fails with `deno: not found` — expected sandbox
  limitation, unrelated to this change.

**Open items carried forward (not resolved in this session, flagged to
the user):**
- `esb_app_id` real values per restaurant — still not populated for any
  of the 9 restaurants; the route and tests both work correctly with a
  placeholder/missing value (surfacing `MISSING_ESB_APP_ID` → safe 404),
  but real customer redirects need this operational data supplied by ops.
- Final QR Interceptor production domain (Open Decision 2) — still
  undecided; not blocking, the route works under any domain pointed at
  this deployment.
- Restaurant identifier in the QR URL is the raw UUID `id`, not a
  human-friendly slug (no such column exists in the schema) — flagged
  above in Step 4; worth confirming with the user before QR codes are
  physically printed, since a 36-character UUID in every table's QR code
  is functionally fine but not especially pretty/short.

## Task 8: Revised Login Flow (all 4 roles)

**Files:**
- Create: `src/components/RoleLoginFlow.tsx`
- Modify: `src/routes/index.tsx` (wire SS through the new flow)
- Modify: `src/lib/crew-session-identity.ts` (adjust shape if needed)
- Delete/retire: `src/components/CrewIdentityDialog.tsx` (superseded)
- Create: `tests/role-login-flow.test.ts`

- [x] **Step 1: Write failing tests** for the full sequence per the spec:
  code field renders as plain text (no `type="password"`), submitting
  valid code shows the identity-confirmation dialog with the exact
  restaurant display name, "TIDAK" returns to code entry and clears state,
  "YA" advances to role picker, role picker shows exactly 4 options, name
  field is empty (never pre-filled/auto-generated) for every role including
  SS, checked-in datetime field is empty/not pre-filled with current time,
  submitting calls `claim_role_session` with the manually entered values
  unmodified.

- [x] **Step 2: Build `RoleLoginFlow`** as a step-state-machine component
  (`"code" | "confirm" | "role" | "identity"`), reusing
  `validateRestaurantCode` and `loginToRestaurant` unchanged for step 1,
  `claimRoleSession` (Task 6, Step 9) for the final step. For role `"ss"`,
  after `claim_role_session` succeeds, also perform SS's existing
  `claim_crew_session` call (Open Decision 1 resolution: SS gets both a
  `crew_sessions` row via the existing RPC and a `crew_role_sessions` row
  via the new one) so `src/routes/index.tsx`'s existing session-token/
  access-validation code keeps working unmodified.

  **⚠️ Scope addition found during Task 6 Step 9 (2026-08-30):**
  `claimRoleSession` and the other five Task 6 `authenticated`-only RPC
  wrappers (see the Task 6 Step 9 correction note above) now require an
  `accessToken` parameter — a Supabase Auth access token from an
  **anonymous-auth session** (`getSupabaseBrowserClient().auth.signInAnonymously()`,
  the same mechanism already relied on for SS's flow), obtained **once per
  device** before calling any of these server functions. This step must
  therefore perform (or reuse, if already established earlier in the flow)
  an anonymous sign-in for **all four roles** — `ss`, `kasir`, `satgas`,
  and `clear_up` — not only `ss` as originally scoped, and pass the
  resulting `session.access_token` through to `claimRoleSession` (and to
  every subsequent Task 9+ call into `table-occupancy.server.ts`'s
  `authenticated`-only wrappers). Small addition to this task's original
  scope; store the token alongside the existing `CrewSessionIdentity`-style
  storage so it survives a page reload without re-prompting sign-in.

  **⚠️ Correction to this step's original wording, resolved during actual
  implementation (2026-08-30):** the paragraph above (and Open Decision 1
  in the design spec) assumed SS's login would *also* call the legacy
  `claim_crew_session` RPC so `crew_sessions`/`crew_session_tokens` kept
  working unmodified. During implementation the user made a final,
  overriding call — **"Option B"**: SS's session continues exactly as it
  was *before* Task 8, with `crewIdentity.crewSessionId` /
  `crewSessionToken` always stored as empty strings, and the historical
  `claim_crew_session` RPC / heartbeat mechanism **never called again,
  anywhere, by anyone**. `RoleLoginFlow.tsx` documents this explicitly at
  its top (`// Option B (user decision, 2026-08-30): ...`) and
  `tests/role-login-flow.test.ts` has an explicit assertion that
  `claim_crew_session` is never invoked. This is the actual, live,
  implemented behavior — treat this note as superseding the "SS gets both
  a `crew_sessions` row... and a `crew_role_sessions` row" sentence above
  and Open Decision 1 in
  `specs/2026-08-29-table-occupancy-tracking-design.md`. Do not resurrect
  the `claim_crew_session` call in any later task.

  **⚠️ Build-safety fix discovered while implementing this step
  (2026-08-30):** `role-session.server.ts`'s `verifyRoleSessionToken` had
  a static top-level `import` of `node:crypto`, which leaked the Node
  built-in into the client bundle once `RoleLoginFlow.tsx` imported
  `claimRoleSession` from the same file (caught by
  `tests/restaurant-login-build.test.ts`). Fixed by switching to a
  dynamic `import("node:crypto")` inside the function body, matching the
  existing split pattern already used in `restaurant-code.server.ts`. No
  scope change, just a build-correctness fix worth knowing about before
  touching this file again.

- [x] **Step 3: Wire `src/routes/index.tsx`** to render `RoleLoginFlow`
  instead of `CrewIdentityDialog` when no crew identity is hydrated; on
  completion for role `"ss"`, populate the same `CrewIdentity` shape the
  rest of the page already expects (audio-unlock call stays here, since
  it's a browser-gesture requirement unrelated to login flow structure).
  For roles `"kasir" | "satgas" | "clear_up"`, redirect (client-side
  navigation) to that role's route (`/kasir`, `/satgas`, `/clear-up`)
  instead of rendering the soundboard.

- [x] **Step 4: Delete `src/components/CrewIdentityDialog.tsx`** once
  nothing imports it.

- [x] **Step 5: Run tests — must pass (green).**

  **Task 8 closure note (2026-08-30):** implemented as commit `9cd2a7d`
  (`feat(auth): implement Task 8 revised login flow (SS/Kasir/Satgas/Clear
  Up)`) — added `role-session-domain.ts` (client-safe role metadata),
  `RoleLoginFlow.tsx`, `ensureAnonAccessToken` in `supabase-browser.ts`,
  the `RoleSessionIdentity` localStorage shape in
  `crew-session-identity.ts`, and 25 new tests
  (`role-session-domain.test.ts` + `role-login-flow.test.ts`). A follow-up
  commit `d91537d` fixed 5 pre-existing-style prettier/eslint formatting
  issues introduced by this task's new files (whitespace-only,
  `eslint --fix`) plus one test assertion that had over-fitted an exact
  single-line import string (relaxed to a tolerant regex). Final state at
  closure: **75/75 test files, 465/465 tests green**; `tsc --noEmit`,
  `deno check`, `eslint`, and `vite build` all clean (`npm run verify`
  full green). Both commits pushed to `origin/genspark_ai_developer`. No
  new PR opened yet for this task — still pending per the standing
  "never merge to `main` without fresh explicit permission" rule; a PR
  covering Task 8 (and likely folded together with Tasks 9-14 at Task
  14's integration-commit step) is still outstanding.

## Task 9: Shared Role-UI Infrastructure

**Files:**
- Create: `src/lib/use-layout-preference.ts`
- Create: `src/hooks/use-table-occupancy-realtime.ts`
- Create: `tests/use-layout-preference.test.ts`,
  `tests/use-table-occupancy-realtime.test.ts`

- [x] **Step 1: Write failing tests** for `useLayoutPreference(role)`:
  defaults to `"grid"` when `localStorage` is empty, persists a change,
  reads back the persisted value on next mount, is scoped per role (Kasir's
  choice doesn't affect Satgas's).

- [x] **Step 2: Implement `useLayoutPreference`** — thin `localStorage`
  wrapper, key shape `table-talker.layout.{role}`.

- [x] **Step 3: Write failing tests** for
  `useTableOccupancyRealtime(restaurantId)`: subscribes to
  `table-occupancy:{restaurantId}` broadcast channel, invokes a provided
  refetch callback on `invalidate` event, rate-limits to at most once/sec,
  falls back to interval polling (e.g. 10–15s) if channel status is
  terminal, cleans up subscription on unmount. Explicitly assert it never
  starts any fixed-interval "keep-alive" ping to the server (i.e., its only
  outbound calls are the caller-provided refetch, never a bespoke
  heartbeat RPC) — this test exists specifically to prevent regressing
  back toward the removed pattern.

- [x] **Step 4: Implement the hook**, modeled on the *shape* of
  `use-remote-crew.ts`'s channel-subscribe/cleanup lifecycle but stripped
  of everything presence/heartbeat-related — i.e., borrow the
  subscribe/unsubscribe/cleanup skeleton, not the heartbeat timer.

- [x] **Step 5: Run tests — must pass (green).**

## Task 10: Kasir Route

**Files:**
- Create: `src/routes/kasir/index.tsx`
- Create: `tests/kasir-route.test.ts`

- [x] **Step 1: Write failing tests**: renders grid/list per persisted
  preference; tapping an empty (green) table shows a confirmation dialog;
  confirming calls `setTableOccupiedKasir`; tapping an already-occupied
  (red) table is disabled/no-op (Kasir never marks a table empty); realtime
  update from another device reflects without manual refresh.
- [x] **Step 2: Build the page** using `OwnerUi.tsx` components
  (`OwnerPage`, `OwnerPageHeader`, `OwnerPanel`) and the existing
  slate/amber palette; green = KOSONG, red = TERISI per spec; layout toggle
  control wired to `useLayoutPreference("kasir")`; live data via
  `getTableOccupancySnapshot` + `useTableOccupancyRealtime`.
- [x] **Step 3: Run tests — must pass (green).**

  Pre-flight fix (found during Task 10 work, before Step 1): `RoleLoginFlow`
  handed a fully claimed `RoleSessionIdentity` to `src/routes/index.tsx`'s
  `onRoleContinue`, but that handler only navigated away with it — it never
  called `writeRoleSessionIdentity`, so Kasir (and Satgas/Clear Up once
  built) would land on their route with nothing in `sessionStorage`, making
  `readRoleSessionIdentity()` always return `null` there. Fixed by mirroring
  the existing SS/`writeCrewSessionIdentity` branch. Covered by
  `tests/role-session-identity-persistence.test.ts`.

## Task 11: Satgas Route (incl. Escort Intent flow)

**Files:**
- Create: `src/routes/satgas/index.tsx`
- Create: `tests/satgas-route.test.ts`

- [ ] **Step 1: Write failing tests**: read-only live grid of all 100
  tables; an "Escort" action per KOSONG table that calls
  `createEscortIntent`; after 30 minutes with no state change, the UI
  surfaces a "Konfirmasi" prompt scoped only to the Satgas session that
  created that specific intent (a different Satgas session, or a fresh
  page load under a different `role_session_id`, must not see someone
  else's pending intent); confirming calls `confirmEscortIntent`; an intent
  resolved by an incoming QR scan before 30 minutes simply disappears with
  no prompt (no cancel button needed, matches spec).
- [ ] **Step 2: Build the page** — read-only grid + escort action button +
  polling/derived check for expired unresolved intents belonging to the
  current session (client-side timer comparing `expires_at` to
  `Date.now()`, consistent with the spec's "client-side-only" cost
  philosophy — no extra server polling beyond the existing occupancy
  snapshot/realtime feed, since escort intents can be included in the same
  snapshot RPC response for the caller's own session).
- [ ] **Step 3: Run tests — must pass (green).**

## Task 12: Clear Up Route

**Files:**
- Create: `src/routes/clear-up/index.tsx`
- Create: `tests/clear-up-route.test.ts`

- [ ] **Step 1: Write failing tests**: list view (list is the natural
  default here, grid still available per preference) of currently-`TERISI`
  tables, sorted descending by occupied duration computed purely from
  `occupied_at` via `Date.now() - occupied_at` on a client `setInterval`
  (assert no additional server call is made merely to render/update the
  duration); tapping a table calls `setTableEmptyCleanup`; a table that was
  never `TERISI` never appears in this list.
- [ ] **Step 2: Build the page** — list/grid toggle via
  `useLayoutPreference("clear_up")`, duration badge component using the
  client-only timer, `OwnerUi.tsx` styling.
- [ ] **Step 3: Run tests — must pass (green).**

## Task 13: Manager Dashboard Data-Contract Verification (no UI)

**Files:** none created; verification-only task.

- [ ] **Step 1:** Confirm, by writing a throwaway read-only query (not
  committed) against staging, that `table_occupancy_state` and
  `crew_role_sessions` alone are sufficient to compute: live Kosong/Terisi
  counts per restaurant, and a shift audit list (Name + `checked_in_at`)
  filtered to a single `restaurant_id`. If any gap is found, raise it
  before Phase 2 planning rather than after building Kasir/Satgas/CU
  against an incomplete schema.
- [ ] **Step 2:** Document the confirmed queries (or gaps) as a short note
  appended to the design spec's Open Decisions section, closing Open
  Decision 4. No route, no manager-login code, no `restaurant_managers`
  table is created in this task — Phase 2 remains untouched.

## Task 14: Final Regression, Full-Repo Sweep, Integration Commit

**Files:** none new; verification and cleanup only.

- [ ] **Step 1:** Full-repo grep sweep confirming zero remaining references
  to every removed identifier (`remote_commands`, `crew_messages`,
  `heartbeat_crew_session`, `create_remote_command`, `ack_remote_command`,
  `claim_pending_remote_command`, `expire_remote_commands`,
  `cleanup_remote_commands`, `use-remote-crew`, `use-crew-message`,
  `CrewMessageOverlay`, `owner-broadcast`) outside of the new destructive
  migration file itself (which legitimately contains `drop function ...`
  statements referencing the old names).
- [ ] **Step 2:** `npm run verify` (test + typecheck + `check:edge` + lint +
  build) passes clean.
- [ ] **Step 3:** Manual smoke pass across all 4 roles' login flow end to
  end (code → confirm → role → name/time → role UI) against a staging
  restaurant, plus one real QR-interceptor redirect test hitting a live
  table URL and confirming both the redirect and the resulting occupancy
  state change.
- [ ] **Step 4:** Tenant isolation check — attempt (in staging/test) to
  read or mutate Restaurant B's `table_occupancy_state`/`crew_role_sessions`
  rows using Restaurant A's role session token; must fail with
  `INVALID_SESSION`/`INVALID_TENANT_SESSION` at the RPC layer, never merely
  hidden client-side.
- [ ] **Step 5:** Squash into one comprehensive commit per this project's
  Git workflow, open/update the PR with a summary covering both the removal
  and the addition, and share the PR link.

---

## Self-Review

- Task ordering matches the design spec's explicit instruction: removal
  (Tasks 1–4) fully lands and is verified green before any additive schema
  or UI work begins.
- Every item in the design spec's "Removal Scope" table has a corresponding
  deletion step in Tasks 1–3; every item in "Explicitly kept" has an
  explicit non-removal note or a regression test protecting it
  (`playback-events.server.ts`, local audio cache/playback, usage history,
  announcement panel, dashboard auto-refresh channel).
- No task introduces a heartbeat, presence flag, or fixed-interval
  keep-alive call — `use-table-occupancy-realtime.ts` is explicitly tested
  in Task 9 to guarantee this.
- Every new table/RPC in Tasks 5–7 follows the codebase's established
  `security definer` / `set search_path = public` / `auth.uid()`-gated /
  named-exception / RLS-revoke-by-default conventions — no new security
  posture is invented.
- SS's login flow gains the new manual Nama+JamMasuk step (Task 8) while
  its underlying `crew_sessions`/`crew_session_tokens`/access-validation
  machinery is preserved unchanged apart from the Task 1 column narrowing.
  **⚠️ Correction (2026-08-30):** this no longer matches Open Decision 1's
  original recommendation (SS also gaining a `crew_role_sessions` row via
  the new RPC) — the user's actual, final, implemented decision is
  **Option B** (see the Task 8 Step 2 correction note above): SS's session
  stays exactly as it was pre-Task-8, `claim_crew_session`/heartbeat is
  never called by anyone again. Treat this bullet's "matching the approved
  Open Decision 1 resolution" as superseded by Option B.
- Manager Dashboard remains Phase 2 in every task — Task 13 only verifies
  the schema will support it later, ships no code.
- Every task ends in a runnable, testable state (`npm run verify` gate at
  Task 4 and Task 14) rather than leaving the app broken mid-plan.

**Status as of 2026-08-30 (updated — this line was stale until now):**
Tasks 1 through 8 are complete, verified (`npm run verify` full green,
465/465 tests / 75/75 files), committed, and pushed to
`origin/genspark_ai_developer` (latest: `d91537d`). **Tasks 9 through 14
below have zero code written for them yet** — that is the actual, current,
accurate starting point for whoever picks this plan up next. The original
closing sentence here ("no source file listed here has been created or
modified yet; execution starts only on explicit go-ahead") described this
plan's state at the moment it was first written and is no longer true —
kept below, struck through, for historical context only:

~~This document is a plan only — no source file listed here has been
created or modified yet; execution starts only on explicit go-ahead.~~
