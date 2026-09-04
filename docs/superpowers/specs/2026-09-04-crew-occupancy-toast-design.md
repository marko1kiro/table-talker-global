# Crew Occupancy Realtime Notice (Header Ticker) — Design Spec

Date: 2026-09-04
Status: Approved (pending user review of this written spec)

## Problem

Crew (Kasir / Satgas / Clear Up) want a live, at-a-glance heads-up whenever any
table's status changes anywhere in the restaurant -- including changes made by
other crew and by customers scanning QR. Today the private realtime channel only
carries an `{table_number, revision}` "invalidate" hint that triggers a silent
snapshot refetch; nothing tells a crew member *what* changed or *who* did it.

Goal: surface a compact, sticky, auto-rotating notice inside the crew header
showing each status change, without adding new connections or expensive fan-out.

## Decisions (locked with user)

1. **Scope = every occupancy event**, from any actor: kasir occupy, clear-up
   clean, satgas escort-intent, satgas escort-confirm, customer QR scan, and
   customer decline.
2. **Self-exclusion**: the acting crew member does NOT see their own notice
   (WhatsApp-style). Customer actions (no crew session) are seen by all crew.
3. **Placement = sticky header slot**, NOT a floating toast. A dedicated 2-line
   slot is added as a third row inside `CrewHeader`, directly under the
   restaurant-name pill. `CrewHeader` is used only by Kasir/Satgas/Clear Up; the
   SS station uses a different `Header.tsx`, so **SS is excluded by construction**
   and **Satgas is included by construction**.
4. **One notice at a time, FIFO, oldest-first, 2 seconds each, nothing dropped.**
   A burst of N events plays all N in arrival order (oldest first) so older
   events never grow staler by being skipped. No per-table dedup, no cap.
5. **Styling**: notice box has a light magenta background; the acting role is a
   small rounded pill styled like the header role badge but with a blue-cyan
   background. Line 1 = the event, line 2 = `BY <role-pill> : <user>`.
6. **Sonner is NOT used** for this feature (no `<Toaster/>` mount). The existing
   `src/components/ui/sonner.tsx` is left as-is for any future use.

## Message table (final wording)

| kind | actor_role | Line 1 | Line 2 |
|------|-----------|--------|--------|
| occupied | kasir | `MEJA {n} TERISI` | `[KASIR] : {user}` |
| occupied | satgas | `MEJA {n} TERISI` | `[SATGAS] : {user}` |
| occupied | qr_scan | `MEJA {n} TERISI` | `[SCAN QR]` |
| escorted | satgas | `MEJA {n} DIESCORT` | `[SATGAS] : {user}` |
| cleared | clear_up | `MEJA {n} SUDAH DIBERSIHKAN` | `[C.U] : {user}` |
| cancelled | qr_scan | `MEJA {n} DIBATALKAN` | `[SCAN QR]` |

- `{user}` = `crew_role_sessions.display_name` of the acting session.
- Role-pill labels: `kasir`->`KASIR`, `satgas`->`SATGAS`, `clear_up`->`C.U`,
  `qr_scan`->`SCAN QR`.
- Customer rows (`qr_scan`) have no `: {user}` suffix.

## Architecture

Reuse the existing private per-restaurant realtime channel
`table-occupancy:{restaurantId}` (already opened by the 3 crew roles via
`use-table-occupancy-realtime.ts`). Only the broadcast **payload** is enriched
and the client gains a notice queue + a header slot. No new WebSocket, no new
DB writes, no per-user fan-out -- Supabase still fans one publish out to all
subscribers.

```
occupancy RPC (server)
  bump revision
  realtime.send({ table_number, revision, kind, actor_role,
                  actor_name, actor_role_session_id }, 'invalidate',
                'table-occupancy:<rid>', private=true)
        |
        v  (edge fan-out to every subscribed crew client)
use-table-occupancy-realtime.ts  handleInvalidate(payload)
  - existing: revision-gated rate-limited refetch   (unchanged)
  - NEW: if payload.kind present AND payload.actor_role_session_id !== selfRoleSessionId
         -> onNotice(payload)
        |
        v
useNoticeQueue()  push formatted notice; advance head every 2s (FIFO)
        |
        v
<CrewHeader notice={current} />  renders sticky 2-line slot
```

## Components & file changes

### 1. NEW migration `supabase/migrations/20260904090000_occupancy_notice_payload.sql`
Redefines the 6 broadcast RPCs (latest definitions live in
`20260902235600_private_table_occupancy_realtime.sql` and
`20260903013000_decline_qr_scan.sql`). Each keeps its status/revision/escort
behavior byte-for-byte and ONLY changes the `realtime.send(...)` jsonb payload:

- `set_table_occupied_kasir` -> `kind='occupied'`, `actor_role='kasir'`,
  `actor_name` + `actor_role_session_id` from the validated session.
- `set_table_empty_cleanup` -> `kind='cleared'`, `actor_role='clear_up'`, name+id.
- `create_escort_intent` -> `kind='escorted'`, `actor_role='satgas'`, name+id.
- `confirm_escort_intent` -> `kind='occupied'`, `actor_role='satgas'`, name+id.
- `record_qr_scan` -> `kind='occupied'`, `actor_role='qr_scan'`,
  `actor_name=null`, `actor_role_session_id=null`.
- `decline_qr_scan` -> `kind='cancelled'`, `actor_role='qr_scan'`, null, null.

For the 4 crew RPCs, `actor_name` is resolved by joining
`public.crew_role_sessions crs on crs.id = v_session.role_session_id` (the
session row is already loaded in each function); `actor_role_session_id =
v_session.role_session_id`. Payload becomes:
```sql
jsonb_build_object(
  'table_number', p_table_number,
  'revision', v_revision,
  'kind', '<occupied|cleared|escorted|cancelled>',
  'actor_role', '<kasir|clear_up|satgas|qr_scan>',
  'actor_name', v_actor_name,                 -- null for qr_scan
  'actor_role_session_id', v_actor_session_id -- null for qr_scan
)
```
Re-`revoke`/`grant execute` for each redefined function to match its current ACL
(crew RPCs -> `authenticated`; `decline_qr_scan` -> `service_role`). CREATE OR
REPLACE preserves ACL but is restated for clarity. No parameter renames, so no
DROP needed.

### 2. NEW `src/lib/occupancy-notice.ts` (pure, testable)
- `type OccupancyBroadcast = { table_number: number; revision: number; kind:
  "occupied"|"cleared"|"escorted"|"cancelled"; actor_role:
  "kasir"|"clear_up"|"satgas"|"qr_scan"; actor_name: string|null;
  actor_role_session_id: string|null }`
- `type OccupancyNotice = { line1: string; line2: string; roleLabel: string }`
- `parseOccupancyBroadcast(payload: unknown): OccupancyBroadcast | null` --
  validates every field, returns null on any malformed/missing field (so a
  legacy `{table_number, revision}`-only payload yields no notice, no crash).
- `formatOccupancyNotice(b: OccupancyBroadcast): OccupancyNotice | null` --
  applies the message table; returns null for an unknown kind/actor combo.
- `ROLE_PILL_LABEL: Record<actor_role, string>`.

### 3. NEW `src/hooks/use-notice-queue.ts`
- `useNoticeQueue(intervalMs = 2000)` -> `{ push(notice), current }`.
- FIFO array in a ref; `current` = head; a `setInterval` (or chained timeout)
  advances the head every `intervalMs`; `push` appends to the tail. Empty ->
  `current = null`. Uses injected timer for testability (mirrors the realtime
  controller's `setIntervalFn`/`clearIntervalFn` pattern).

### 4. EDIT `src/hooks/use-table-occupancy-realtime.ts`
- Controller deps gain `selfRoleSessionId?: string|null` and
  `onNotice?: (b: OccupancyBroadcast) => void`.
- `useTableOccupancyRealtime(restaurantId, sessionToken, revision, refetch,
  selfRoleSessionId?, onNotice?)` -- two appended optional args (existing 4-arg
  callers keep compiling).
- In `handleInvalidate`: after the existing revision/refetch path, independently
  run `const b = parseOccupancyBroadcast(message); if (b && b.actor_role_session_id
  !== selfRoleSessionId) onNotice?.(b)`. Notify is NOT gated on the revision
  comparison (escort intents may not bump revision but must still notify).

### 5. EDIT `src/components/CrewHeader.tsx`
- New optional prop `notice?: OccupancyNotice | null`.
- Add a third row (below the restaurant-name row) with a **fixed 2-line height**
  so layout never jumps: a rounded box, light magenta background
  (e.g. `bg-fuchsia-50 ring-1 ring-inset ring-fuchsia-200`), line 1 =
  `notice.line1` (bold), line 2 = a cyan role pill
  (`rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold uppercase
  text-white`, matching the header badge shape) + `: {user}` when present.
- When `notice` is null, the row still reserves its height (empty box or a muted
  placeholder), keeping the header stable.

### 6. EDIT the 3 crew pages (`kasir`, `satgas`, `clear-up` `index.tsx`)
- Instantiate `const notices = useNoticeQueue()`.
- Pass `selfRoleSessionId` (from `RoleSessionIdentity.roleSessionId`) and
  `onNotice={(b)=>notices.push(formatOccupancyNotice(b))}` into
  `useTableOccupancyRealtime(...)`.
- Render `<CrewHeader ... notice={notices.current} />`.

## Data flow (example)
Budi (kasir) fills table 5 -> RPC sets terisi, bumps revision, broadcasts
`{kind:'occupied', actor_role:'kasir', actor_name:'Budi', actor_role_session_id:'<budi-sess>'}`.
Sari's clear-up client and the satgas client receive it (Budi's own client
matches `actor_role_session_id` and skips the notice but still refetches). Each
remote client pushes `MEJA 5 TERISI / [KASIR] : Budi` onto its queue; the header
slot shows it for 2s.

## Error handling
- Malformed / legacy payload (no `kind`) -> `parseOccupancyBroadcast` returns
  null -> no notice, refetch still works. Backward compatible with any in-flight
  old-format broadcast during rollout.
- Missing `actor_name` for a crew actor -> line 2 shows just the pill (no `: `).
- Queue is client-side only; a disconnected client simply misses notices (the
  12s polling + refetch still reconcile the grid). No persistence needed.
- Unknown `kind`/`actor_role` combo -> `formatOccupancyNotice` returns null.

## Testing (TDD)
- `tests/occupancy-notice.test.ts`: `parseOccupancyBroadcast` accepts a full
  payload, rejects legacy `{table_number,revision}` and malformed fields;
  `formatOccupancyNotice` produces the exact 2 lines for all 6 table rows
  (incl. `C.U`, `DIESCORT`, `DIBATALKAN`, and the no-user `SCAN QR` rows).
- `tests/use-notice-queue.test.ts`: FIFO order (oldest first), 2s advance with
  fake timers, burst of 3 plays all 3 in order, empty -> null.
- `tests/use-table-occupancy-realtime.test.ts` (extend existing): a non-self
  broadcast calls `onNotice` once; a self broadcast (`actor_role_session_id ===
  selfRoleSessionId`) does NOT call `onNotice` but still refetches; a legacy
  payload refetches without calling `onNotice`.
- `tests/crew-header-notice.test.ts`: source contract -- `CrewHeader` renders a
  `notice` slot with the magenta box + cyan role pill classes; SS `Header.tsx`
  untouched.
- `tests/occupancy-notice-migration.test.ts`: new migration redefines all 6 RPCs
  with `kind`/`actor_role`/`actor_name`/`actor_role_session_id` in the payload
  and preserves the existing status/revision behavior markers.
- EDIT existing broadcast tests that pin the old payload shape
  (`tests/table-occupancy-realtime-broadcast.test.ts`,
  `tests/private-table-occupancy-realtime-migration.test.ts`, and any assertion
  matching `jsonb_build_object('table_number', ..., 'revision', ...)`) to accept
  the enriched payload. The plan fetches these first and updates them as part of
  the migration task's MERAH set.
- Full `npm run verify` exit 0 before commit+push (repo AGENTS.md gate).

## Out of scope
- Changing occupancy status semantics, the snapshot RPC, debounce, or the QR
  confirmation interstitial.
- Sound/vibration on notices (SS owns audio).
- Persisting notice history or a notification center.
- Sonner/`<Toaster/>` wiring.

## Risks / notes
- 6 RPCs redefined -> each body must be ported exactly from the current deployed
  definition (fetched via `pg_get_functiondef`) with only the payload object
  changed; the plan will fetch each live body first.
- A sustained flood (many tables flipping every second) makes the ticker lag
  behind real time by design (user chose completeness over freshness). The grid
  remains the authoritative, instantly-refetched view, so lag is cosmetic.
- `actor_name` adds one indexed join per crew mutation (negligible).
- Supabase assigns its own ledger timestamp on apply; the repo filename is the
  CI-replay source of truth.
