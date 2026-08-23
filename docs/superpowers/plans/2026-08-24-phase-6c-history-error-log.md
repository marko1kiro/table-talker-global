# Phase 6C History And Error Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 7-day default, 30-day bounded History plus searchable Error Log with safe resolution notes.

**Architecture:** Build on 6A/6B. Pure filter module clamps dates before server calls. Protected owner functions select only tenant-scoped playback and synchronization records, paginate newest-first, and return stable codes. Error resolution records optional bounded note, resolver Super Admin context, and timestamp. Broadcast adapter is added only in 6D after broadcast tables exist. Retention scheduler arrives in 6E.

**Tech Stack:** TanStack Start, TanStack Query, Zod, Supabase/PostgreSQL, Vitest node source/pure tests.

---

## Dependency Order

1. Requires 6A shell and 6B restaurant selector.
2. Use migration `20260824003000_owner_history_error_log.sql`, after 6B `20260824002000`.
3. 6D adds broadcast history adapter after creating broadcast tables. 6E schedules cleanup after tables/query UI exist.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/owner-history-domain.ts` | Seven-to-thirty-day range, bounded query/search, resolution note validation. |
| `src/lib/owner-history.server.ts` | Protected playback/sync paginated history; 6D adds broadcast adapter. |
| `src/lib/operational-errors.server.ts` | Protected filtering and resolution audit fields/results. |
| `src/routes/super-admin/history.tsx` | History filters, tabs, pagination, partial/retry states. |
| `src/routes/super-admin/error-log.tsx` | Error search/filter/detail/resolve UI. |
| `supabase/migrations/20260824003000_owner_history_error_log.sql` | Resolution columns/indexes and safe owner RPCs. |
| `tests/owner-history-domain.test.ts` | Pure date/note tests. |
| `tests/owner-history-error-source.test.ts` | Server/route source contract. |

### Task 1: Define bounded range and optional-note behavior red

**Files:**
- Create: `tests/owner-history-domain.test.ts`
- Create: `tests/owner-history-error-source.test.ts`

- [ ] **Step 1: Write failing domain tests**

```ts
import { expect, it } from "vitest";
import { normalizeHistoryRange, validateResolutionNote } from "../src/lib/owner-history-domain";
it("defaults to seven days and rejects windows over retained thirty days", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");
  expect(normalizeHistoryRange({}, now).days).toBe(7);
  expect(normalizeHistoryRange({ from: "2026-07-01T00:00:00.000Z", to: now.toISOString() }, now)).toEqual({ ok: false, code: "RANGE_TOO_WIDE" });
});
it("permits omitted resolution note and bounds supplied note", () => {
  expect(validateResolutionNote(undefined)).toEqual({ ok: true, note: null });
  expect(validateResolutionNote("x".repeat(1001))).toEqual({ ok: false, code: "INVALID_NOTE" });
});
```

- [ ] **Step 2: Write failing source contract**

```ts
import { readFileSync } from "node:fs"; import { expect, it } from "vitest";
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
it("protects history/errors and records safe resolution metadata", () => {
  expect(file("src/lib/owner-history.server.ts")).toContain("requireSuperAdmin()");
  expect(file("src/lib/operational-errors.server.ts")).toContain("resolution_note");
  expect(file("src/lib/operational-errors.server.ts")).toContain("resolved_by");
});
```

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/owner-history-domain.test.ts tests/owner-history-error-source.test.ts`

Expected: FAIL resolving `owner-history-domain` and missing `owner-history.server.ts`.

### Task 2: Add safe data model and server functions

**Files:**
- Create: `supabase/migrations/20260824003000_owner_history_error_log.sql`
- Create: `src/lib/owner-history-domain.ts`
- Create: `src/lib/owner-history.server.ts`
- Modify: `src/lib/operational-errors.server.ts`

- [ ] **Step 1: Add migration**

```sql
alter table public.operational_errors add column if not exists resolution_note text check (char_length(resolution_note) <= 1000);
alter table public.operational_errors add column if not exists resolved_by text;
create index if not exists operational_errors_owner_filter_idx on public.operational_errors (restaurant_id, occurred_at desc);
create index if not exists playback_events_owner_history_idx on public.playback_events (restaurant_id, event_timestamp desc);
create index if not exists remote_commands_owner_history_idx on public.remote_commands (target_session_id, created_at desc);
```

Current `remote_commands` schema has `target_session_id`, not `restaurant_id`; join `crew_sessions` on `remote_commands.target_session_id = crew_sessions.id` and scope `crew_sessions.restaurant_id`. Do not add a broadcast query or broadcast table reference in this migration.

- [ ] **Step 2: Implement pure range/note functions**

```ts
export function normalizeHistoryRange(input: { from?: string; to?: string }, now: Date) {
  const to = input.to ? new Date(input.to) : now; const from = input.from ? new Date(input.from) : new Date(to.getTime() - 7 * 86_400_000);
  if (!Number.isFinite(+from) || !Number.isFinite(+to) || from > to) return { ok: false as const, code: "INVALID_RANGE" as const };
  if (to.getTime() - from.getTime() > 30 * 86_400_000) return { ok: false as const, code: "RANGE_TOO_WIDE" as const };
  return { ok: true as const, from: from.toISOString(), to: to.toISOString(), days: Math.ceil((to.getTime() - from.getTime()) / 86_400_000) };
}
export function validateResolutionNote(value: string | undefined) {
  const note = value?.trim() ?? null;
  return !note || note.length <= 1000 ? { ok: true as const, note } : { ok: false as const, code: "INVALID_NOTE" as const };
}
```

- [ ] **Step 3: Add history server query**

`listOwnerHistory` accepts `{ restaurantId?, type?: "playback" | "sync", status?, text?, from?, to?, page }`; normalize range before query; page size fixed at 50; text search trimmed/max 100 and applied only to safe label/report fields; query playback and synchronization with tenant filter where `restaurantId` supplied; order newest-first; return `{ ok: true, rows, nextPage }` or stable `INVALID_RANGE`, `RANGE_TOO_WIDE`, `UNAVAILABLE`. It calls `requireSuperAdmin()` first. `sync_cache` is reused from existing `OPERATIONS_ERROR_CODES`; do not invent stage names.

- [ ] **Step 4: Upgrade error functions**

Extend `listOperationalErrors` filters with optional UUID restaurant, stage/report code bounded at 60, `resolved`, normalized date range, bounded text search, page. Select explicit safe columns, not `*`. Change resolution input to `{ errorId, note?: string }`; validate note, obtain resolver identity from authenticated Super Admin session, update only unresolved matching ID with `resolved_at`, `resolved_by`, `resolution_note`, and return `ALREADY_RESOLVED` or `NOT_FOUND` rather than database wording.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/owner-history-domain.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit server/data change**

```bash
git add supabase/migrations/20260824003000_owner_history_error_log.sql src/lib/owner-history-domain.ts src/lib/owner-history.server.ts src/lib/operational-errors.server.ts tests/owner-history-domain.test.ts
git commit -m "feat: add owner history error data"
```

### Task 3: Implement History and Error Log routes

**Files:**
- Modify: `src/routes/super-admin/history.tsx`
- Modify: `src/routes/super-admin/error-log.tsx`

- [ ] **Step 1: Run route source test before route implementation**

Append this route-only assertion first:

```ts
it("renders seven-day History default", () => {
  expect(file("src/routes/super-admin/history.tsx")).toContain("7 hari");
});
```

Run: `npx vitest run tests/owner-history-error-source.test.ts`

Expected: FAIL because History route lacks `7 hari` text.

- [ ] **Step 2: Build History controls and list**

Set local default dates from `normalizeHistoryRange({}, new Date())`; visibly label `7 hari terakhir`. Offer restaurant, type, status, date inputs, and search. Reject >30 days client-side with stable copy, but server remains authority. Render pagination 50 rows/newest-first for playback and synchronization. Render no Broadcast tab until 6D adapter lands. Display loading, no results, retry error, and partial source unavailable status without blocking other history types.

- [ ] **Step 3: Build Error Log controls and safe detail**

Render restaurant/stage/report code/date/resolved/search filters. Detail shows report code, stage, sanitized detail, device/session identifiers, resolved time/by/note. Never render token, encrypted credential, service key, or raw database error. Resolution dialog textarea is optional and maxLength `1000`; success invalidates error, detail, dashboard keys; stable codes map to user-safe messages.

- [ ] **Step 4: Run focused verification and restore generated tree**

Run: `npx vitest run tests/owner-history-domain.test.ts tests/owner-history-error-source.test.ts && npx tsc --noEmit && npm run lint && npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: all exit `0`; run serially to avoid Nitro cache races.

- [ ] **Step 5: Commit UI**

```bash
git add src/routes/super-admin/history.tsx src/routes/super-admin/error-log.tsx tests/owner-history-error-source.test.ts
git commit -m "feat: add owner history and error log"
```

## Plan Self-Review

- [x] History includes playback and sync initially; 6D adds broadcasts after tables exist. Seven-day default, 30-day cap, filters, search, pagination, newest sorting, loading/empty/error/partial states remain covered.
- [x] Error Log includes required filters, safe detail, resolved records remaining visible, optional note, resolver/time audit, and stable result codes.
- [x] Retention is intentionally scheduled in 6E, never browser-driven.
