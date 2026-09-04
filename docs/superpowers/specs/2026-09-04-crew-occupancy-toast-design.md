# Crew Occupancy Realtime Notice + Compact Header — Design Spec

Date: 2026-09-04
Status: Approved (pending user review of this written spec)

## Problem

Two coupled crew-UI needs:

1. **Live notices.** Crew (Kasir / Satgas / Clear Up) want an at-a-glance heads-up
   whenever any table's status changes anywhere in the restaurant -- including
   changes by other crew and by customers scanning QR. Today the private realtime
   channel only carries an `{table_number, revision}` "invalidate" hint that
   triggers a silent refetch; nothing says *what* changed or *who* did it.
2. **Header too tall on phones.** `CrewHeader` currently uses two stacked rows
   (logo+role+user / restaurant-name pill), which wastes vertical space on small
   screens. Restructure it into one compact row and free a single second row for
   the notice ticker.

## Decisions (locked with user)

### Notices
1. **Scope = every occupancy event**, any actor: kasir occupy, clear-up clean,
   satgas escort-intent, satgas escort-confirm, customer QR scan, customer
   decline.
2. **Self-exclusion**: the acting crew member does NOT see their own notice
   (WhatsApp-style). Customer actions (no crew session) are seen by all crew.
3. **Placement = sticky header slot**, NOT a floating toast. Sonner is not used.
4. **One notice at a time, FIFO, oldest-first, 2 seconds each, nothing dropped.**
   A burst of N plays all N in arrival order (oldest first) so older events never
   grow staler by being skipped. No per-table dedup, no cap.
5. **Styling**: notice box = light magenta background; the acting role = a small
   rounded pill shaped like the header role badge but with a blue-cyan
   background. Line 1 = event, line 2 = `BY <role-pill> : <user>`.

### Header redesign
6. **One compact row + one notice row.** Restaurant label moves to sit to the
   **right of the logo** (row 1, left cluster). The role badge moves to sit
   **under the username** (row 1, right cluster, left of the logout button). Both
   fonts shrink. The old standalone restaurant-name row is removed.
7. **Restaurant label format** = `{CODE} - {BRANCH}`, uppercased (CSS), where
   `{BRANCH}` is `restaurantDisplayName` with a leading "Mie Gacoan" removed.
   Example: code `CKRBUL`, display `Mie Gacoan Kampung Bulu` -> `CKRBUL - KAMPUNG
   BULU`.
8. **Code source = login/identity (option A).** `loginToRestaurant` returns the
   validated code; it is persisted as `restaurantCode` on `RoleSessionIdentity`
   and passed to `CrewHeader`. `restaurantCode` is **optional in the reader** so
   pre-existing sessions are NOT invalidated -- they simply render branch-only
   until the crew member logs in again.

## Notice message table (final wording)

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
`use-table-occupancy-realtime.ts`). Only the broadcast **payload** is enriched;
the client gains a notice queue + a header slot; the header is re-laid-out and
given the restaurant code. No new WebSocket, no new DB writes, no per-user
fan-out -- Supabase still fans one publish out to all subscribers.

```
occupancy RPC (server)
  bump revision
  realtime.send({ table_number, revision, kind, actor_role,
                  actor_name, actor_role_session_id }, 'invalidate',
                'table-occupancy:<rid>', private=true)
        |  (edge fan-out to every subscribed crew client)
        v
use-table-occupancy-realtime.ts  handleInvalidate(payload)
  - existing: revision-gated rate-limited refetch   (unchanged)
  - NEW: parse payload; if kind present AND actor_role_session_id !== selfRoleSessionId
         -> onNotice(payload)
        v
useNoticeQueue()  push formatted notice; advance head every 2s (FIFO, no drop)
        v
<CrewHeader restaurantCode notice ... />  one compact row + sticky notice slot
```

## Components & file changes

### 1. NEW migration `supabase/migrations/20260904090000_occupancy_notice_payload.sql`
Redefines the 6 broadcast RPCs (latest bodies live in
`20260902235600_private_table_occupancy_realtime.sql` and
`20260903013000_decline_qr_scan.sql`). Each keeps its status/revision/escort
behavior byte-for-byte and ONLY changes the `realtime.send(...)` jsonb payload:

- `set_table_occupied_kasir` -> `kind='occupied'`, `actor_role='kasir'`, name+id.
- `set_table_empty_cleanup` -> `kind='cleared'`, `actor_role='clear_up'`, name+id.
- `create_escort_intent` -> `kind='escorted'`, `actor_role='satgas'`, name+id.
- `confirm_escort_intent` -> `kind='occupied'`, `actor_role='satgas'`, name+id.
- `record_qr_scan` -> `kind='occupied'`, `actor_role='qr_scan'`, name=null, id=null.
- `decline_qr_scan` -> `kind='cancelled'`, `actor_role='qr_scan'`, name=null, id=null.

For the 4 crew RPCs, `actor_name` is resolved by joining
`public.crew_role_sessions crs on crs.id = v_session.role_session_id` (the
session row is already loaded); `actor_role_session_id = v_session.role_session_id`.
Payload:
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
Re-`revoke`/`grant execute` per function to match current ACL (crew RPCs ->
`authenticated`; `decline_qr_scan` -> `service_role`). No parameter renames, so no
DROP needed.

### 2. Restaurant code plumbing (option A)
- `src/lib/restaurants.server.ts` -- `loginToRestaurant` success return adds
  `code: validated.code` (the canonical validated code; header uppercases it).
- `src/components/RoleLoginFlow.tsx` -- `LoginResult` type gains `code: string`;
  `setLogin({ ..., code: result.code })`; `onRoleContinue({ ..., restaurantCode:
  login.code })`.
- `src/lib/crew-session-identity.ts` -- `RoleSessionIdentity` gains
  `restaurantCode: string`. `writeRoleSessionIdentity` persists it.
  `readRoleSessionIdentity` treats it as **optional**: if present and a string,
  use it; otherwise default `""` (do NOT clear the session). This keeps existing
  sessions valid (branch-only) until re-login.
- The 3 crew pages pass `restaurantCode={identity.restaurantCode}` to
  `CrewHeader`.

### 3. NEW `src/lib/restaurant-label.ts` (pure, testable)
- `formatRestaurantLabel(code: string, displayName: string): string`
  - `branch = displayName.replace(/^\s*mie\s+gacoan\s+/i, "").trim()`; if `branch`
    is empty, fall back to the full trimmed `displayName`.
  - return `code.trim() ? `${code.trim()} - ${branch}` : branch`.
  - (Casing is left to the header's `uppercase` class.)

### 4. NEW `src/lib/occupancy-notice.ts` (pure, testable)
- `type OccupancyBroadcast = { table_number: number; revision: number; kind:
  "occupied"|"cleared"|"escorted"|"cancelled"; actor_role:
  "kasir"|"clear_up"|"satgas"|"qr_scan"; actor_name: string|null;
  actor_role_session_id: string|null }`
- `type OccupancyNotice = { line1: string; line2: string; roleLabel: string }`
- `parseOccupancyBroadcast(payload: unknown): OccupancyBroadcast | null` --
  validates every field; returns null on any malformed/missing field (a legacy
  `{table_number, revision}` payload yields no notice, no crash).
- `formatOccupancyNotice(b): OccupancyNotice | null` -- applies the message table;
  null for an unknown kind/actor combo.
- `ROLE_PILL_LABEL: Record<actor_role, string>`.

### 5. NEW `src/hooks/use-notice-queue.ts`
- `useNoticeQueue(intervalMs = 2000)` -> `{ push(notice), current }`.
- FIFO array in a ref; `current` = head; a timer advances the head every
  `intervalMs`; `push` appends to the tail; empty -> `current = null`. Nothing is
  dropped. Injected timer for testability (mirrors the realtime controller's
  `setIntervalFn`/`clearIntervalFn`).

### 6. EDIT `src/hooks/use-table-occupancy-realtime.ts`
- Controller deps gain `selfRoleSessionId?: string | null` and
  `onNotice?: (b: OccupancyBroadcast) => void`.
- `useTableOccupancyRealtime(restaurantId, sessionToken, revision, refetch,
  selfRoleSessionId?, onNotice?)` -- two appended optional args (existing 4-arg
  callers keep compiling).
- In `handleInvalidate`: keep the existing revision/refetch path, then
  independently `const b = parseOccupancyBroadcast(message); if (b &&
  b.actor_role_session_id !== selfRoleSessionId) onNotice?.(b)`. Notify is NOT
  gated on the revision comparison (escort intents must still notify).

### 7. EDIT `src/components/CrewHeader.tsx` (re-layout + notice slot)
Props: `{ role, restaurantName, restaurantCode, userName, onLogout, notice? }`.
- **Row 1** (`flex items-center justify-between`, tighter `py`):
  - Left: logo (`h-6 sm:h-7`) + restaurant label span to its right
    (`truncate`, smaller `text-[11px] sm:text-xs font-extrabold uppercase`,
    content `formatRestaurantLabel(restaurantCode, restaurantName)`).
  - Right (`flex items-center gap-2`): a vertical stack (`flex flex-col
    items-end`) of username (`text-xs font-bold truncate`) over the **role badge**
    (existing slate pill, shrunk to `text-[9px] sm:text-[10px]`), then the logout
    button to the right of that stack.
- **Row 2** (notice slot): fixed 2-line height so layout never jumps. When
  `notice` present: a rounded box, light magenta bg
  (`bg-fuchsia-50 ring-1 ring-inset ring-fuchsia-200`), line 1 = `notice.line1`
  (bold), line 2 = cyan role pill (`rounded-full bg-cyan-600 px-2 py-0.5
  text-[10px] font-bold uppercase text-white`) + `: {user}` when present. When
  `notice` is null, the row keeps its reserved height (empty box).
- The old standalone restaurant-name row is removed.

### 8. EDIT the 3 crew pages (`kasir`, `satgas`, `clear-up` `index.tsx`)
- `const notices = useNoticeQueue()`.
- Pass `selfRoleSessionId={identity.roleSessionId}` and
  `onNotice={(b)=>{ const n = formatOccupancyNotice(b); if (n) notices.push(n); }}`
  into `useTableOccupancyRealtime(...)`.
- Render `<CrewHeader ... restaurantCode={identity.restaurantCode}
  notice={notices.current} />`.

## Data flow (example)
Budi (kasir) fills table 5 -> RPC sets terisi, bumps revision, broadcasts
`{kind:'occupied', actor_role:'kasir', actor_name:'Budi', actor_role_session_id:'<budi-sess>'}`.
Sari's clear-up client and the satgas client receive it (Budi's own client
matches `actor_role_session_id` and skips the notice but still refetches). Each
remote client pushes `MEJA 5 TERISI / [KASIR] : Budi` onto its queue; the header
slot shows it for 2s.

## Error handling
- Malformed / legacy payload (no `kind`) -> `parseOccupancyBroadcast` null -> no
  notice, refetch still works. Backward compatible during rollout.
- Missing `actor_name` for a crew actor -> line 2 shows just the pill (no `: `).
- `restaurantCode` absent (pre-existing session) -> label renders branch-only.
- Queue is client-side only; a disconnected client misses notices (12s polling +
  refetch still reconcile the grid). No persistence.
- Unknown `kind`/`actor_role` combo -> `formatOccupancyNotice` null.

## Testing (TDD)
- `tests/restaurant-label.test.ts`: `formatRestaurantLabel("CKRBUL","Mie Gacoan
  Kampung Bulu")` -> `"CKRBUL - Kampung Bulu"`; no code -> `"Kampung Bulu"`;
  name without the brand prefix -> unchanged; brand-only name -> falls back to
  full name.
- `tests/occupancy-notice.test.ts`: `parseOccupancyBroadcast` accepts a full
  payload, rejects legacy `{table_number,revision}` and malformed fields;
  `formatOccupancyNotice` produces the exact 2 lines for all 6 rows (incl. `C.U`,
  `DIESCORT`, `DIBATALKAN`, no-user `SCAN QR`).
- `tests/use-notice-queue.test.ts`: FIFO oldest-first, 2s advance (fake timers),
  burst of 3 plays all 3 in order, empty -> null.
- `tests/use-table-occupancy-realtime.test.ts` (extend existing): non-self
  broadcast calls `onNotice` once; self broadcast does NOT call `onNotice` but
  still refetches; legacy payload refetches without `onNotice`.
- `tests/crew-header-notice.test.ts`: source contract -- `CrewHeader` renders the
  compact single-row layout (restaurant label beside logo, role badge under
  username), the magenta notice box + cyan role pill classes, and takes a
  `restaurantCode` prop; SS `Header.tsx` untouched.
- `tests/crew-session-identity.test.ts` (extend existing): `restaurantCode`
  round-trips through write/read; a stored identity WITHOUT `restaurantCode`
  still reads back (defaults to `""`, session not cleared).
- `tests/occupancy-notice-migration.test.ts`: new migration redefines all 6 RPCs
  with the enriched payload and preserves status/revision behavior markers.
- EDIT existing broadcast tests that pin the old payload shape
  (`tests/table-occupancy-realtime-broadcast.test.ts`,
  `tests/private-table-occupancy-realtime-migration.test.ts`) to accept the
  enriched payload.
- Full `npm run verify` exit 0 before commit+push (repo AGENTS.md gate).

## Out of scope
- Changing occupancy status semantics, the snapshot RPC, debounce, or the QR
  confirmation interstitial.
- Sound/vibration on notices (SS owns audio).
- Persisting notice history or a notification center.
- Sonner/`<Toaster/>` wiring.
- Restyling the SS station `Header.tsx`.

## Risks / notes
- 6 RPCs redefined -> each body ported exactly from the current deployed
  definition (fetched via `pg_get_functiondef`) with only the payload object
  changed; the plan fetches each live body first.
- A sustained flood makes the ticker lag behind real time by design (user chose
  completeness over freshness); the grid stays authoritative and instantly
  refetched, so lag is cosmetic.
- `actor_name` adds one indexed join per crew mutation (negligible).
- Header re-layout must keep the sticky behavior and not clip long usernames /
  branch names (both `truncate`).
- Supabase assigns its own ledger timestamp on apply; the repo filename is the
  CI-replay source of truth.
