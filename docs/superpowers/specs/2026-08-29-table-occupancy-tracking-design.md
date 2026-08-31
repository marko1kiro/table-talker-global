# Table Occupancy Tracking (and Remote-Command/Heartbeat Removal) — Design Spec

## Status

Design only. No migration, RPC, route, or component code exists yet. This
document is the reference for the eventual implementation plan
(`docs/superpowers/plans/2026-08-29-table-occupancy-tracking.md`, not yet
written). Manager Dashboard is approved conceptually but explicitly deferred
to Phase 2; this spec still defines its data contract now so Phase 1 schema
never needs a breaking change to support it later.

This spec covers two coupled efforts decided in the same design session:
(1) the new table-occupancy-tracking feature (Kasir/Satgas/Clear Up roles,
QR Interceptor, revised login flow), and (2) the **destructive removal** of
the existing remote-command/heartbeat/broadcast-message subsystem, which
the user determined is no longer needed once occupancy is tracked
structurally, and whose always-on per-device heartbeat cost is worth
eliminating outright. See "Removal Scope" for the full deletion list before
reading the additive design below.

## Goal

Give restaurant floor staff a real-time view of which of a restaurant's
tables (`TABLE_COUNT = 100`, per existing `remote-audio-domain.ts`) are
occupied, so **Satgas** (front-door greeter) can decide instantly whether to
seat a walk-in or hold them in a physical notebook. There is no PIC-level
ESB Order API access, so occupancy is inferred from a **QR Interceptor**
(customers' dine-in QR scans redirect through our own server before landing
on the real ESB order page) plus manual corrections from **Kasir** and
**Clear Up**, with a narrow, accountable **Satgas** fallback override.

This is additive to the existing SS/soundboard product for audio playback
itself (SS keeps its local-cache-based audio download and playback
unchanged). It is **not** additive with respect to the remote-command/
heartbeat/broadcast subsystem — that subsystem is explicitly removed as part
of this Major Update (see "Removal Scope" below), per user decision: "gw
jawab intinya apapun yang berhubungan dengan heartbeat dan remote
audio/messages di hilangkan. selain itu pertahankan." It reuses the existing
`restaurants` tenant model, the existing `Kode Resto` login primitive
(`login_to_restaurant_atomic`, `restaurant_access_tokens`), the existing
`crew_sessions`/`crew_session_tokens` identity-and-access-validation
primitive (stripped of its presence columns, see below), and the existing
`OwnerUi.tsx` clean-theme component library for every role UI except SS
(which stays neo-brutalist).

## Removal Scope (explicit deletion, part of this Major Update)

Confirmed by the user after a heartbeat-cost discussion during design: the
remote-command/heartbeat/broadcast-message subsystem exists solely to
support Super Admin's targeted "play audio on a specific device remotely"
and "send a text message to crew devices" features. Neither capability is
needed once table occupancy is tracked structurally (QR Interceptor + role
UIs replace the operational need that motivated remote-triggering audio at
a specific table). The user explicitly decided to delete this entire
subsystem rather than keep it dormant, to eliminate its always-on 10-second
heartbeat cost. This is a **destructive removal**, not a deprecation:

| Layer | Removed |
| --- | --- |
| Database tables | `remote_commands`, `crew_messages` |
| `crew_sessions` columns | `device_description`, `audio_ready`, `visibility_state`, `connection_state`, `last_seen`, `offline_at` — every presence/heartbeat-only column. `crew_sessions` itself is **kept**, narrowed to identity fields only (`id`, `normalized_name`, `display_name`, `created_at`, `updated_at`), because `crew_session_tokens`, `claim_crew_session`, `validateCrewAccessInBackground`'s periodic re-check, and `playback-events.server.ts`'s `display_name` lookup all still depend on it for non-presence reasons. |
| RPCs | `heartbeat_crew_session`, `create_remote_command`, `ack_remote_command`, `claim_pending_remote_command`, `expire_remote_commands`, `cleanup_remote_commands` |
| Hooks | `src/hooks/use-remote-crew.ts` (heartbeat timer, presence channel, remote-command processor/ack/retry), `src/hooks/use-crew-message.ts` |
| Components | `src/components/CrewMessageOverlay.tsx` |
| Routes | `/super-admin/broadcast` and its sidebar nav entry |
| Server libs | `src/lib/owner-broadcast.server.ts`, `src/lib/owner-broadcast-domain.ts`, `src/lib/owner-broadcast-idempotency.server.ts`, `src/lib/owner-broadcast-retry.ts` |
| Dashboard | The "Crew Online" metric (`active_crew_devices` in `owner_dashboard_rpc`) is removed — it has no accurate meaning without presence heartbeat. Dashboard metric grid goes from 6 to 5 cards. |
| Restaurant detail page | `src/routes/super-admin/restaurants/$id.tsx`'s online-device/presence display is removed. |
| Tests | Every test file exercising the above: `tests/use-remote-crew.test.ts`, `tests/remote-audio-hook.test.ts`, `tests/remote-commands-restaurant-id.test.ts`, `tests/owner-broadcast-domain.test.ts`, `tests/owner-broadcast-idempotency.test.ts`, `tests/owner-broadcast-retry.test.ts`, `tests/owner-broadcast-source.test.ts`, `tests/crew-message-integration.test.ts`, `tests/crew-messages-restaurant-id.test.ts`, and any other test asserting removed heartbeat/presence/broadcast behavior (surveyed via full-repo grep for `remote_commands`, `crew_messages`, `heartbeat_crew_session`, `use-remote-crew`, `owner-broadcast`, `CrewMessageOverlay`).

Explicitly **kept, unchanged in purpose** (only their presence-adjacent
fields/dependencies are pruned):

- SS's manifest-based audio download to browser Cache Storage and local
  playback from cache — zero relationship to the removed subsystem.
- `crew_sessions` (narrowed) + `crew_session_tokens` + `claim_crew_session`
  — still the identity/access-validation primitive behind SS login and the
  periodic `validateCrewAccessInBackground` check (a lightweight "is my
  session still valid" poll every 30s, unrelated to heartbeat/presence).
- Usage history / playback analytics (`owner_history`,
  `playback-events.server.ts`, the "Riwayat" super-admin tab) — this
  records what audio was played, by whom, when; it has no dependency on
  remote commands or heartbeat.
- The announcement panel in `SoundboardGrid.tsx` — plays local cached audio
  on tap, never remotely triggered.
- The Super Admin dashboard's own `owner-dashboard` Realtime Broadcast
  `invalidate` channel (auto-refetch admin data on change) — this is an
  admin-UI-refresh mechanism unrelated to crew-device heartbeat; it is kept,
  and its future trigger source becomes occupancy-state changes instead of
  broadcast-message sends.

Because this removal happens in the same effort as adding the occupancy
feature, the eventual implementation plan is structured as **removal tasks
first, then additive tasks** — deleting dead code/schema before building on
a now-simplified `crew_sessions` avoids doing throwaway integration work
against fields that are about to disappear.

## Non-Goals (explicitly out of scope for Phase 1)

- Waiting-list / queue feature. Satgas manages holds in a physical notebook.
  No app feature, no history, no reporting for this.
- QR code image generation or printing. Restaurant managers own that; our
  responsibility ends at a working redirect endpoint.
- ESB webhook/API integration. Revisit only if organizational PIC access to
  ESB Core is granted later.
- Manager Dashboard **UI and routes** (Phase 2). Its data contract is
  defined here so Phase 1 tables need no shape change later.
- Any change to `TableStatus` (`"empty" | "ready" | "playing" | "loading"`)
  in `TableButton.tsx` — that type is SS's audio-playback state and is
  unrelated. The new occupancy state uses a distinctly named type,
  `TableOccupancyStatus`, to avoid confusion/collision.

## Roles

| Role | New/Existing | Theme | Primary capability |
| --- | --- | --- | --- |
| SS | Existing, login flow changes only | Neo-brutalist (unchanged) | Table-call soundboard + announcements. No occupancy UI. |
| Kasir | New | Clean/minimal (`OwnerUi.tsx` style) | Manual KOSONG→TERISI for counter-paid dine-in (bypasses QR). |
| Satgas | New | Clean/minimal | Read-only live grid of all tables + narrow "escort intent" override. |
| Clear Up (CU) | New | Clean/minimal | Manual TERISI→KOSONG after physically observing a table is clean. |
| System (QR Interceptor) | New, not a login role | n/a | Primary automatic KOSONG→TERISI trigger via QR scan. |
| Manager (Phase 2) | New, deferred | Clean/minimal | Read-only counters + crew audit trail, strictly tenant-isolated. |

SS keeps its functional scope unchanged (soundboard, announcements,
neo-brutalist theme). Only its **login flow** changes (see below): the
auto-generated crew name (`autoCrewName()` in `CrewIdentityDialog.tsx`) is
**removed** for SS too. Per user decision ("SS = Opsi A"), every role —
including SS — now requires fully manual Nama + Tanggal & Jam Masuk entry.

## State Machine

Two states only, per explicit user correction of an earlier over-engineered
4-state draft:

```
KOSONG (green)  <--->  TERISI (red)
```

No intermediate "needs cleaning" state. A table that needs cleaning is still
`TERISI` until Clear Up marks it `KOSONG` after physically cleaning it.

Transition sources:

| Transition | Actor | Trigger |
| --- | --- | --- |
| KOSONG → TERISI | System | QR Interceptor logs a scan for that table (primary signal) |
| KOSONG → TERISI | Kasir | Manual tap, for counter-paid dine-in orders that never scan a QR |
| KOSONG → TERISI | Satgas | "Escort intent" fallback, only after 30 minutes with no QR confirmation, only by the Satgas who escorted that customer (see below) |
| TERISI → KOSONG | Clear Up | Manual tap after physically cleaning the table (only transition CU may perform) |

Satgas and Clear Up never perform the *opposite* transition of their primary
capability — Satgas cannot mark a table empty, Clear Up cannot mark a table
occupied except via the CU-owned TERISI→KOSONG direction. This keeps
authorship of each transition auditable and matches the physical workflow
(Satgas escorts people in, CU verifies people are gone and the table is
clean).

## QR Interceptor

### Pattern

Replace the physical table QR code target with a link to our own domain
(temporary: `qr.xdirga.xyz`), keyed by restaurant + table number:

```
https://qr.xdirga.xyz/r/{restaurantSlugOrId}/t/{tableNumber}
```

Request handling, in order, fail-open:

1. Parse restaurant + table number from the path.
2. Look up the real ESB order URL for that restaurant (a small per-restaurant
   config, not a per-scan input — the ESB base path + `mode=dinein` are
   static per tenant, only `tableNumber` varies).
3. Fire a **non-blocking** write: insert a `qr_scan_events` row (or emit an
   equivalent occupancy-set command). The HTTP response's 302 must not wait
   on this write completing if it can be done asynchronously without risking
   an unhandled rejection; if it must be awaited for correctness, its budget
   is bounded and any failure is swallowed — the redirect always proceeds.
4. Issue `302 Found` to the real ESB URL
   (`https://esborder.qs.esb.co.id/APP/{tenantAppId}/order?mode=dinein&tableNumber={tableNumber}`).

Zero perceptible impact to the customer: one extra redirect hop, sub-100ms.
Verified capacity: ~10,800 requests/day worst case across all 9 restaurants
combined — negligible for any serverless/edge target.

### Why this is the primary signal

QR scan happens at T+1–3 minutes after a customer sits down — far more
accurate than any SS-soundboard-driven inference (which lags 25–40 minutes
in the worst case, per the earlier stale-data analysis). QR scan therefore
owns the KOSONG→TERISI transition whenever it is available; Kasir and
Satgas exist only to cover the cases QR structurally cannot (counter-paid
orders never scan; Satgas escort-to-seating has a QR-registration lag).

### Idempotency

A table already `TERISI` receiving another scan (e.g., customer reopens the
menu) must be a no-op on occupancy state — it does not reset `occupied_at`,
does not create a duplicate active state row. This also means repeated scans
never inflate the Clear Up duration-sort or the Satgas 30-minute timer.

## Data Model

All new tables carry `restaurant_id` (FK to existing `public.restaurants`)
and follow the existing tenant-isolation convention (RLS enabled, service-role
only unless a specific `authenticated`-gated RPC is granted, mirroring
`crew_session_tokens` / `claim_crew_session`).

### `table_occupancy_state`

One row per (restaurant, table_number) — current state only, not history.

| Column | Type | Notes |
| --- | --- | --- |
| `restaurant_id` | uuid, FK, not null | part of composite PK |
| `table_number` | integer, not null, check 1..100 | part of composite PK |
| `status` | text, not null, check in `('kosong','terisi')` | the 2-state machine |
| `occupied_at` | timestamptz, nullable | set when transitioning to `terisi`; cleared on `kosong`. Already-required data — reused as-is by both the Satgas 30-minute rule and the Clear Up client-side duration sort, at zero extra query cost. |
| `occupied_source` | text, not null, check in `('qr_scan','kasir','satgas_escort')` | who/what caused the current `terisi` state; audit context, not a history table |
| `updated_at` | timestamptz, not null default now() | |

Primary key: `(restaurant_id, table_number)`. This table is small (100 rows
per restaurant) and is the single source of truth read by every role's live
grid. Changes are broadcast via a lightweight Realtime Broadcast
`invalidate` channel per restaurant (see Realtime Strategy below) rather
than raw Postgres Changes subscriptions, to keep the same "no client-side
raw-row subscription" posture already established elsewhere in this
codebase (e.g. the Super Admin dashboard's own `owner-dashboard` broadcast
channel) — and specifically without any per-device heartbeat/presence
machinery, which this Major Update removes (see Removal Scope).

No separate transition-history/log table in Phase 1 — out of scope, matches
"no history/reporting needed" decision for the (removed) waiting list, and
keeps this feature's DB footprint minimal. If audit-grade transition history
is wanted later, it is an additive table, not a Phase-1 requirement.

### `qr_scan_events`

Append-only log written by the QR Interceptor. Decoupled from
`table_occupancy_state` so interceptor writes never block on occupancy
business logic, and so interceptor failures never affect the redirect.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK, default `gen_random_uuid()` | |
| `restaurant_id` | uuid, FK, not null | |
| `table_number` | integer, not null | |
| `scanned_at` | timestamptz, not null default now() | |

Retention: 30 days, matching existing operational-error/history retention
convention (`owner_history`, `operational_errors`). Cleanup job follows the
same `cleanup_*` + scheduler-state pattern already used for
`cleanup_owner_retention()` / `run_owner_retention()`.

### `table_escort_intents`

The Satgas fallback override staging record. Non-committal: creating one
does **not** change `table_occupancy_state` by itself.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `restaurant_id` | uuid, FK, not null | |
| `table_number` | integer, not null | |
| `actor_session_id` | uuid, FK to the new role-session table, not null | scoped to the specific Satgas who escorted the customer |
| `created_at` | timestamptz, not null default now() | |
| `expires_at` | timestamptz, not null | `created_at + interval '30 minutes'` |
| `resolved` | boolean, not null default false | true once either a QR scan confirms the table or the Satgas confirms via the override dialog |

Lifecycle:

1. Satgas escorts a customer to table N → app creates an escort-intent row
   for (restaurant, N, this Satgas's session).
2. If a QR scan for table N arrives before `expires_at`: the intent is
   implicitly satisfied (system transition wins); the row is marked
   `resolved = true` (or simply left to expire — no cleanup action is load-
   bearing, since the row is inert after `expires_at`).
3. If `expires_at` passes with no QR scan **and** table N is still `kosong`:
   the UI surfaces this specific escort intent (only to the Satgas who
   created it — `actor_session_id` scoping) with a confirmation dialog
   ("Apakah kamu benar mengantar tamu ke Meja {N}?" YA/TIDAK-style, per the
   established misclick-protection pattern). Confirming performs the
   KOSONG→TERISI transition with `occupied_source = 'satgas_escort'`.
4. No manual cancel action exists. An unused/declined escort intent simply
   expires and disappears from the UI — matches the explicit decision that
   misclick protection is "a simple confirmation dialog, no separate cancel
   button."

This design prevents Satgas from guessing/pre-emptively marking tables
occupied at scan time (race condition), while still allowing an accountable,
actor-scoped correction when the QR signal never arrives.

Retention: rows are inert after `expires_at` and cheap (100-table scale);
cleanup follows the same 30/90-day sweep convention as other audit tables
rather than being load-bearing for correctness.

### `crew_role_sessions`

Generalizes the existing `crew_sessions` audit/session concept for the four
field roles, but is a **new table**, not a widening of `crew_sessions` — SS
keeps using `crew_sessions`/`crew_session_tokens` (post-removal, narrowed to
identity fields only — see Removal Scope; SS never had presence/heartbeat
fields that would need to "not apply" to Kasir/Satgas/CU, since those
fields are deleted entirely, not merely unused by the new roles).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid, PK | |
| `restaurant_id` | uuid, FK, not null | |
| `role` | text, not null, check in `('ss','kasir','satgas','clear_up')` | included for symmetry/future Manager Dashboard filtering even though SS rows continue to also exist in `crew_sessions` — see Open Decision below |
| `display_name` | text, not null | fully manual input, no `autoCrewName()` |
| `checked_in_at` | timestamptz, not null | **manual** entry by the crew member, Asia/Jakarta wall-clock semantics; NOT `now()`/server-assigned, because crew may log in late and the timestamp must reflect actual shift start for audit purposes |
| `created_at` | timestamptz, not null default now() | actual row-creation time, kept separately from `checked_in_at` for integrity/debugging — never shown as "the" audit time |
| `session_token_hash` | text, FK-equivalent to a token table analogous to `crew_session_tokens` | bearer-token verifier, same opaque-random-token pattern as existing sessions |

This table is the data source for the Phase-2 Manager Dashboard's crew audit
trail ("Name + check-in time, to verify shift conditions"). Building it now
(Phase 1) costs nothing extra since every role login must collect this data
regardless of whether Manager Dashboard exists yet — this is the concrete
meaning of the user's "kalau gratis, approved" for the dashboard: the
dashboard itself is deferred, but its data source is populated from day one.

### Manager auth tier (Phase 2, contract only)

Not implemented in Phase 1. Recorded here only so Phase 1 schema does not
need to change shape later:

- A new `restaurant_managers` credential table, structurally parallel to
  `restaurants.code_hash/code_encrypted` (HKDF-derived HMAC lookup + AES-GCM
  storage, never plaintext at rest) but scoped `restaurant_id`-per-manager —
  i.e. a manager credential authorizes exactly one `restaurant_id`, never
  "all restaurants" like `/super-admin` does.
- Every Manager Dashboard read (`table_occupancy_state`, `crew_role_sessions`
  counters) must filter by the manager's own `restaurant_id`, enforced
  server-side (RPC/RLS), never client-side — same posture as every existing
  tenant-scoped query in this codebase (`restaurant_access_tokens`,
  `audio_manifests`, etc. are all `restaurant_id`-gated at the query layer,
  not merely hidden in the UI).
- This is a **new, distinct auth tier** from `/super-admin`
  (`super-admin/route.tsx` — platform-wide, manages *all* restaurants). The
  two must never share a login surface, a token type, or a permission check
  function, to make cross-tenant leakage structurally impossible rather than
  policy-enforced.

## Login Flow (all 4 roles, final)

Supersedes the current SS-only `CrewIdentityDialog.tsx` flow. Sequence,
per the user's final revision (role picked **before** name/time, code
field never masked):

```
1. Input Kode Resto
   - Plain visible text input (no type="password", no reveal toggle —
     this is the crew-facing flow, distinct from the super-admin
     RestaurantCredentialDialog's masked owner-facing code display).
   - Reuses validateRestaurantCode() from restaurant-domain.ts unchanged.
   - Submit calls loginToRestaurant() unchanged — it already returns
     { restaurantId, displayName, tenantToken } which is exactly what
     step 2 needs.
2. Confirmation dialog
   - "Apakah kamu login ke Resto {displayName}?"  [YA] [TIDAK]
   - TIDAK: discard the tenant token, return to step 1, clear the code
     field.
   - YA: proceed to step 3. This step exists purely to catch
     typo-based wrong-restaurant logins before any role/session state
     is created — no server call happens here, it's a client-side
     confirmation of data already returned in step 1's response.
3. Pilih Role
   - [SS] [Kasir] [Satgas] [Clear Up]
   - Determines which manual-entry form and which role UI comes next.
4. Input Nama + Tanggal & Jam Masuk
   - Nama: free-text manual input, no auto-generation, for ALL four
     roles including SS (SS = "Opsi A" — autoCrewName() is removed).
   - Tanggal & Jam Masuk: manual date+time picker, Asia/Jakarta
     (GMT+7) wall-clock, NOT pre-filled with the current time — crew
     may log in late and must record actual shift-start time for
     audit purposes.
   - Submitting claims the role-specific session (new RPC analogous to
     claim_crew_session, scoped by role) and stores checked_in_at
     exactly as typed.
5. Enter role UI
   - SS → existing soundboard route (unchanged), now fed by the new
     login flow instead of the old one-field dialog.
   - Kasir / Satgas / Clear Up → new routes, OwnerUi.tsx-derived theme.
```

Open decision this flow surfaces for SS specifically: whether SS's session
continues to be created via the existing `claim_crew_session` RPC (writing
to `crew_sessions`, unchanged) with only the *dialog* replaced, or whether SS
should also gain a `crew_role_sessions` row for Manager Dashboard audit-trail
symmetry with the other three roles. Recorded under Open Decisions below —
does not block writing this spec, but must be resolved before the
implementation plan is written.

## UI / Theme

- SS: unchanged neo-brutalist theme, unchanged route (`src/routes/index.tsx`),
  only the login dialog underneath it changes.
- Kasir, Satgas, Clear Up: new routes, styled with the existing
  `OwnerUi.tsx` component set (`OwnerPage`, `OwnerPageHeader`, `OwnerPanel`,
  `OwnerField`, `StatusBadge`, `OwnerNotice`, `OwnerLoading`, `OwnerEmpty`,
  `OwnerRetry`) and the same palette already used by `/super-admin`
  (`bg-slate-50 text-slate-950`, `border-slate-200 bg-white`, `rounded-2xl`,
  `shadow-sm`, `amber-500` accent) — explicitly not neo-brutalist.
- Colors: KOSONG = light green (not gray — avoids "is this tappable?"
  ambiguity), TERISI = red.
- Layout: grid vs list is user-configurable per role UI, persisted via
  `window.localStorage` (device-scoped, not account-scoped, no server
  round-trip) — deliberately a different storage mechanism from
  `crew-session-identity.ts`'s `sessionStorage` (tab-scoped identity) since
  a layout preference should survive across tabs/sessions on the same
  device while identity should not.
- Clear Up's table list is sorted/highlighted by occupied-duration, computed
  entirely client-side from `occupied_at` (already fetched as part of
  `table_occupancy_state`) — a plain `setInterval`/`Date.now() - occupied_at`
  computation, zero additional server or DB cost.

## RPC Surface (names only, no implementation)

Following the existing `security definer`, `set search_path = public`,
`auth.uid()`-gated, named-exception convention (`claim_crew_session`,
`login_to_restaurant_atomic`):

| RPC | Purpose | Callable by |
| --- | --- | --- |
| `claim_role_session` | Analogous to `claim_crew_session`; validates tenant token, inserts `crew_role_sessions` row with manual `display_name` + `checked_in_at`, issues session token | authenticated (post-QR-login anonymous auth, same as today) |
| `set_table_occupied_kasir` | Kasir-only KOSONG→TERISI | authenticated, role-checked against the caller's `crew_role_sessions` row |
| `set_table_empty_cleanup` | Clear Up-only TERISI→KOSONG | authenticated, role-checked |
| `create_escort_intent` | Satgas creates a staging record for a table they escorted a customer to | authenticated, role-checked |
| `confirm_escort_intent` | Satgas confirms their own expired, unconfirmed intent, causing KOSONG→TERISI with `occupied_source='satgas_escort'` | authenticated, `actor_session_id` must equal caller's session |
| `record_qr_scan` | Interceptor's fire-and-forget write; sets `table_occupancy_state` to TERISI (idempotent no-op if already TERISI) and inserts a `qr_scan_events` row | service-role only (called from the interceptor server, never from a browser) |

Every mutating RPC raises named exceptions (`UNAUTHORIZED`,
`INVALID_ROLE`, `INVALID_TABLE_NUMBER`, `INVALID_SESSION`, etc.), matching
the existing style in `20260812000000_super_admin_remote_audio.sql` and
`20260823105000_crew_session_tokens.sql`.

## Realtime Strategy

Deliberately **not** a heartbeat/presence design — that pattern is being
removed from this codebase specifically because of its always-on per-device
cost (see Removal Scope). Occupancy sync only needs simple event-driven
fan-out with no per-device keep-alive:

A public Realtime Broadcast `invalidate` event per restaurant (channel
`table-occupancy:{restaurantId}`, no payload beyond a change signal) is
emitted only when a mutating RPC actually changes `table_occupancy_state`
(i.e., never on a no-op idempotent QR re-scan). Kasir/Satgas/Clear Up
clients subscribe to that channel and refetch the restaurant's occupancy
grid on receipt, client-rate-limited to at most once/second, with periodic
polling (e.g., every 10-15s) as a passive fallback if the channel drops —
same reliability posture already proven for the Super Admin dashboard's own
`owner-dashboard` broadcast channel. No client ever holds an open
timer that pings the server on a fixed interval merely to announce
liveness; the client is otherwise fully idle between real occupancy
changes. This keeps Satgas's live grid, Kasir's grid, and Clear Up's list
in sync without exposing row-level Realtime reads to `anon`/`authenticated`
roles and without reintroducing a heartbeat cost.

## Security / Tenant Isolation

- Every new table is `restaurant_id`-scoped and RLS-enabled with
  `revoke all ... from public, anon, authenticated` at the table level,
  mutations exposed only through the RPCs above — matching the existing
  posture for `crew_session_tokens`, `restaurant_access_tokens`, etc.
  No table is directly readable/writable by client roles.
- Role-scoped RPCs verify the caller's `crew_role_sessions.role` server-side
  before allowing a role-specific mutation (e.g., a Satgas session token
  cannot call `set_table_empty_cleanup`). This mirrors how
  `claim_crew_session` already verifies `restaurant_access_tokens` validity
  before trusting a client-supplied `restaurant_id`.
- The QR Interceptor endpoint is unauthenticated by necessity (customers hit
  it with no login), so `record_qr_scan` must be callable only by the
  interceptor's own server-side service-role credential, never exposed to
  any browser-reachable RPC grant.
- Manager Dashboard (Phase 2) tenant isolation is a hard requirement per
  user instruction ("jangan campuri urusan resto lain") — captured above as
  an architectural constraint on the future `restaurant_managers` design,
  not an app-layer/UI-only check.

## Capacity / Performance

Re-affirming the earlier analysis: worst case ~10,800 QR-interceptor
requests/day across all 9 restaurants combined. Each request is a single
indexed upsert-or-no-op plus an insert into a small append-only log, well
within Postgres/Supabase free-to-low-tier throughput, and the redirect
response is never gated on that write completing beyond a small bounded
budget. Realtime broadcast volume is bounded by actual state-transition
count (occupied/emptied events), not by request volume — scans that hit an
already-`TERISI` table produce a DB no-op and should not re-broadcast.

## Errors

Client-facing errors stay generic where they already are today (`Kode Resto
salah.` unchanged). New role-specific failures use plain Indonesian messages
consistent with existing UI copy style (e.g., a confirmation dialog is the
only gate — no raw exception text reaches the crew UI). Server-side, every
new RPC raises named exceptions and unexpected failures land in the existing
`operational_errors` sanitized-error table, not raw logs.

## Tests (to be detailed in the implementation plan, not written yet)

- State-machine unit tests: every legal transition per role, every illegal
  transition rejected (e.g., Satgas cannot call the Kasir RPC).
- Idempotency test: repeated QR scans on an already-`TERISI` table produce
  no duplicate `occupied_at` reset and no extra broadcast.
- Escort-intent lifecycle test: creation, implicit resolution by a QR scan
  arriving first, expiry-then-confirm path, actor-scoping (a different
  Satgas session cannot confirm someone else's intent).
- Tenant isolation test: a role session for Restaurant A cannot read/mutate
  Restaurant B's `table_occupancy_state` rows or RPCs.
- Login flow test: code visible/unmasked, confirmation dialog blocks
  progression until YA, role picker gates which manual-entry form renders,
  manual `checked_in_at` is stored exactly as submitted (not overwritten by
  server time).
- Capacity/perf smoke test on the interceptor redirect path (redirect must
  complete even if the logging write fails/times out — fail-open guarantee).

## Rollback

Additive-only for Phase 1: every new table is new, `crew_sessions`/SS
routes/RPCs are untouched except the login dialog swap. Rollback is simply
disabling the new routes/RP› grants and reverting the login dialog to the
prior single-field version; no destructive migration is required at any
point in this feature, unlike the earlier restaurant-code-login work which
had a deliberate destructive cleanup phase.

## Open Decisions (must be resolved before writing the implementation plan)

1. **SS session model**: does SS's login now also write a `crew_role_sessions`
   row (role=`ss`) for Manager Dashboard audit-trail symmetry, in addition to
   its existing (now-narrowed, identity-only) `crew_sessions` row — or does
   SS's manual Nama+JamMasuk get captured only in `crew_role_sessions` and
   `crew_sessions` stops storing a separate `display_name`? Recommendation:
   keep `crew_sessions` for what it still does after the heartbeat/presence
   removal (uniqueness-checked identity + `crew_session_tokens` +
   `validateCrewAccessInBackground` + `playback-events.server.ts`'s
   `display_name` lookup) and additionally write one `crew_role_sessions`
   row per SS login purely for audit-trail purposes — additive, no risk to
   existing SS functionality.
2. **QR Interceptor domain**: `qr.xdirga.xyz` is confirmed temporary. Final
   production domain, TLS/DNS ownership, and hosting target (same
   Vercel/Cloudflare stack, or a separate lightweight edge function) are not
   yet decided.
3. **Tenant App ID mapping**: the interceptor needs each restaurant's ESB
   `APP/{id}` segment (seen in the example
   `https://esborder.qs.esb.co.id/APP/1294/order?...`) — this is small
   per-restaurant config data, not yet modeled as a column; likely a new
   nullable field on `restaurants` (e.g., `esb_app_id`), populated manually
   per restaurant the same way credentials are provisioned today.
4. **Manager Dashboard implementation timing** — confirmed Phase 2, no
   further action needed now beyond the schema-compatibility guarantees
   already built into `table_occupancy_state` and `crew_role_sessions`.
   **CLOSED (Task 13, verified live against `kjzxtmxdbcanvkgqqdow`):** both
   guarantees hold, with one implementation detail to carry into the
   Phase 2 RPC (not a schema gap — no migration needed):
   - **Live Kosong/Terisi counts per restaurant**: `table_occupancy_state`
     only ever holds a row for a `(restaurant_id, table_number)` that has
     had at least one transition — confirmed live (a sample restaurant had
     3 rows, all `status = 'kosong'`, leftover from earlier
     terisi→kosong cycles; rows persist, they are never deleted on
     Clear Up). A naive `group by status` on this table alone therefore
     *undercounts* `kosong` (untouched tables have no row at all). The
     correct query is the same `generate_series(1, 100)` LEFT JOIN
     pattern already live in `get_table_occupancy_snapshot` (Task 6) —
     confirmed identical and reusable, not a new pattern to invent:
     ```sql
     select coalesce(tos.status, 'kosong') as status, count(*)
     from generate_series(1, 100) as gs(table_number)
     left join table_occupancy_state tos
       on tos.restaurant_id = $1 and tos.table_number = gs.table_number
     group by 1;
     ```
   - **Shift audit list (Name + `checked_in_at`) per restaurant**:
     `claim_role_session` (Task 6) is insert-only — one new
     `crew_role_sessions` row per login, never updated/overwritten —
     confirmed live (a sample restaurant showed 4 distinct rows across
     3 roles/logins). `select display_name, role, checked_in_at from
     crew_role_sessions where restaurant_id = $1 order by checked_in_at
     desc` is sufficient as-is. No gap.
   - **Access path**: both tables have RLS enabled with zero policies
     defined (confirmed live via `pg_policies`) — i.e. service-role only,
     same posture as every other table in this feature. Direct
     client-side `select`s will always return zero rows for
     anon/authenticated callers by design. This confirms (does not
     change) the "Manager auth tier" contract above: Phase 2 must read
     both counts and the audit list through a new `SECURITY DEFINER` RPC
     that validates the manager's session is scoped to the requested
     `restaurant_id`, mirroring `get_table_occupancy_snapshot`'s existing
     role/tenant check — never a raw table select.
   Full verification queries and results: `docs/breakdown-task13-manager-dashboard-verification.md`.

## Self-Review

- No feature in this document exceeds what has been explicitly agreed in
  conversation: 2-state machine, 4 field roles, QR Interceptor, escort
  intent w/ 30-min timeout, no waiting list, no QR image generation, clean
  theme for non-SS roles, `localStorage` layout persistence, manual
  Nama+JamMasuk for all roles including SS, Manager Dashboard deferred but
  tenant-isolated by design, revised login order (role before name/time),
  unmasked code field, restaurant-identity confirmation dialog.
- Removal scope matches the user's explicit final instruction verbatim
  ("apapun yang berhubungan dengan heartbeat dan remote audio/messages
  dihilangkan, selain itu pertahankan"): every heartbeat/presence/remote-
  command/broadcast-message artifact is listed for deletion; every other
  existing capability (audio cache/playback, `crew_sessions` identity core,
  usage history, announcement panel, admin dashboard auto-refresh) is
  explicitly listed as kept, with a stated reason it is unrelated to the
  removed subsystem.
- No Manager Dashboard UI, route, or manager-login code is specified as
  Phase 1 work — only its data contract, to avoid a later breaking schema
  change.
- `TableStatus` (audio-playback) and the new `TableOccupancyStatus` concept
  are kept explicitly distinct to prevent the naming collision noted during
  research.
- The new Realtime Strategy is deliberately heartbeat-free (event-driven
  broadcast only, no fixed-interval keep-alive), consistent with the reason
  the old subsystem is being removed rather than reused.
- Every new table/RPC follows the codebase's existing tenant-isolation,
  RLS-revoke-by-default, and named-exception conventions rather than
  introducing a new security posture.
- This document contains no code, no migration SQL, and no component
  implementation — spec only, per explicit instruction.
