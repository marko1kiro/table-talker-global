# Phase 6D Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send safe text broadcasts to one restaurant or all active restaurants with exact all-target confirmation and visible partial outcomes.

**Architecture:** Build on 6A-6C. Pure domain code validates scope/message/confirmation and groups per-restaurant results. One protected server function resolves active sessions on server, creates one delivery command per eligible device, bounds restaurants/devices/rate, and uses `Promise.allSettled` semantics so one tenant cannot roll back others. Browser never supplies device IDs or authorization.

**Tech Stack:** TanStack Start, TanStack Query, Zod, Supabase/PostgreSQL RPC, Vitest node pure/source tests.

---

## Dependency Order

1. Requires 6A shell, 6B active restaurant data, 6C history model.
2. Use migration `20260824004000_owner_broadcast.sql`, after `20260824003000`.
3. 6E validates rollout and retention after this delivery surface exists.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/owner-broadcast-domain.ts` | Scope/message/exact confirmation/result grouping. |
| `src/lib/owner-broadcast.server.ts` | Owner preview/send, rate/batch checks, partial results. |
| `src/routes/super-admin/broadcast.tsx` | Scope form, preview, exact confirm dialog, results. |
| `src/lib/owner-history.server.ts` | Broadcast history adapter added after broadcast tables exist. |
| `supabase/migrations/20260824004000_owner_broadcast.sql` | Delivery table/RPC/index/rate-limit state. |
| `tests/owner-broadcast-domain.test.ts` | Exact confirmation and partial grouping. |
| `tests/owner-broadcast-source.test.ts` | Authorization/route contract. |

### Task 1: Make dangerous all-active behavior red-test first

**Files:**
- Create: `tests/owner-broadcast-domain.test.ts`
- Create: `tests/owner-broadcast-source.test.ts`

- [ ] **Step 1: Write failing pure tests**

```ts
import { expect, it } from "vitest";
import { ALL_CONFIRMATION, validateBroadcastRequest } from "../src/lib/owner-broadcast-domain";
it("requires exact all-active confirmation", () => {
  expect(ALL_CONFIRMATION).toBe("BROADCAST SEMUA");
  expect(validateBroadcastRequest({ scope: "all", message: "Tes", confirmation: "broadcast semua" })).toEqual({ ok: false, code: "CONFIRMATION_REQUIRED" });
  expect(validateBroadcastRequest({ scope: "all", message: "Tes", confirmation: "BROADCAST SEMUA" }).ok).toBe(true);
});
it("requires one restaurant for single scope and bounds message", () => {
  expect(validateBroadcastRequest({ scope: "restaurant", message: "", restaurantId: "x" })).toEqual({ ok: false, code: "INVALID_MESSAGE" });
});
```

- [ ] **Step 2: Write failing source test**

```ts
import { readFileSync } from "node:fs"; import { expect, it } from "vitest";
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
it("server owns target resolution and route presents exact confirmation", () => {
  expect(file("src/lib/owner-broadcast.server.ts")).toContain("requireSuperAdmin()");
  expect(file("src/lib/owner-broadcast.server.ts")).toContain("Promise.allSettled");
});
```

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/owner-broadcast-domain.test.ts tests/owner-broadcast-source.test.ts`

Expected: FAIL resolving `owner-broadcast-domain` and missing `owner-broadcast.server.ts`.

### Task 2: Create broadcast data and partial send boundary

**Files:**
- Create: `supabase/migrations/20260824004000_owner_broadcast.sql`
- Create: `src/lib/owner-broadcast-domain.ts`
- Create: `src/lib/owner-broadcast.server.ts`

- [ ] **Step 1: Add delivery storage/RPC migration**

```sql
create table if not exists public.owner_broadcasts (
  id uuid primary key default extensions.gen_random_uuid(), actor text not null check (actor = 'super-admin'), scope text not null check (scope in ('restaurant','all')),
  restaurant_id uuid references public.restaurants(id), message text not null check (char_length(message) between 1 and 200), created_at timestamptz not null default now()
);
create table if not exists public.owner_broadcast_deliveries (
  id uuid primary key default extensions.gen_random_uuid(), broadcast_id uuid not null references public.owner_broadcasts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id), crew_session_id uuid not null references public.crew_sessions(id), status text not null check (status in ('delivered','rejected','expired','failed')), failure_code text, created_at timestamptz not null default now()
);
create index if not exists owner_broadcast_deliveries_history_idx on public.owner_broadcast_deliveries (restaurant_id, created_at desc);
```

Add service-role-only RPC `create_owner_broadcast_delivery(p_broadcast_id uuid, p_restaurant_id uuid, p_crew_session_id uuid, p_message text)` that verifies target crew belongs to supplied restaurant, is connected/visible/recent, inserts delivery/command atomically, and returns status. Do not grant to browser roles.

- [ ] **Step 2: Implement pure validator**

```ts
export const ALL_CONFIRMATION = "BROADCAST SEMUA";
export { CREW_MESSAGE_MAX_LENGTH } from "./crew-message-domain";
export function validateBroadcastRequest(input: { scope: "restaurant" | "all"; restaurantId?: string; message: string; confirmation?: string }) {
  const message = input.message.trim();
  if (!message || message.length > CREW_MESSAGE_MAX_LENGTH) return { ok: false as const, code: "INVALID_MESSAGE" as const };
  if (input.scope === "restaurant" && !input.restaurantId) return { ok: false as const, code: "RESTAURANT_REQUIRED" as const };
  if (input.scope === "all" && input.confirmation !== ALL_CONFIRMATION) return { ok: false as const, code: "CONFIRMATION_REQUIRED" as const };
  return { ok: true as const, ...input, message };
}
```

- [ ] **Step 3: Implement preview and send**

`previewOwnerBroadcast` calls `requireSuperAdmin()`, accepts `scope` and optional UUID restaurant, resolves only active restaurants and eligible sessions server-side, and returns `{ restaurants, devices }` counts. `sendOwnerBroadcast` calls it again after validation, rate-limits actor to 10 broadcasts/hour, rejects more than 100 restaurants or 500 devices with `BATCH_TOO_LARGE`, inserts broadcast audit row, then executes each restaurant in `Promise.allSettled`. Per restaurant return `{ restaurantId, delivered, rejected, expired, failed, code? }`; successful records remain when others fail. Never return credentials or device token values.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/owner-broadcast-domain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit delivery boundary**

```bash
git add supabase/migrations/20260824004000_owner_broadcast.sql src/lib/owner-broadcast-domain.ts src/lib/owner-broadcast.server.ts tests/owner-broadcast-domain.test.ts tests/owner-broadcast-source.test.ts
git commit -m "feat: add owner broadcast delivery"
```

### Task 3: Build Broadcast UI and result states

**Files:**
- Modify: `src/routes/super-admin/broadcast.tsx`
- Test: `tests/owner-broadcast-source.test.ts`

- [ ] **Step 1: Run route source test before route implementation**

Append this route-only assertion first:

```ts
it("renders exact all-active confirmation", () => {
  expect(file("src/routes/super-admin/broadcast.tsx")).toContain("BROADCAST SEMUA");
});
```

Run: `npx vitest run tests/owner-broadcast-source.test.ts`

Expected: FAIL because Broadcast placeholder lacks `BROADCAST SEMUA`.

- [ ] **Step 2: Implement scope form and preview**

Use local scope, restaurant, message, and confirmation state. Restaurant scope has owner-authorized selector. All scope calls preview after scope selection and renders exact restaurant/device counts before opening send dialog. Import existing `CREW_MESSAGE_MAX_LENGTH` and use `maxLength={CREW_MESSAGE_MAX_LENGTH}`. Loading disables only send/preview control; existing loaded result remains visible if refetch fails.

- [ ] **Step 3: Implement exact confirmation dialog**

For scope `all`, dialog copy repeats `BROADCAST SEMUA`; submit disabled unless input is byte-for-byte exact. Server validation remains mandatory. Single restaurant has normal destructive send confirmation and does not require all-scope phrase.

- [ ] **Step 4: Render partial results**

Render per-restaurant rows and delivered/rejected/expired/failed counts. Overall `partial` message appears when any restaurant fails but successful deliveries remain reported. Link to `/super-admin/history` with broadcast filter. Invalidate Dashboard/History only after response; do not claim delivery before server result.

- [ ] **Step 5: Add broadcast history adapter, then run focused and production checks**

Modify `src/lib/owner-history.server.ts` only after migration table exists. Add `type: "broadcast"` query over `owner_broadcasts` joined to `owner_broadcast_deliveries`, filter by restaurant/range/status, paginate newest-first, and return safe delivery counts. Extend `tests/owner-history-error-source.test.ts` with:

```ts
expect(file("src/lib/owner-history.server.ts")).toContain("owner_broadcast_deliveries");
```

Run: `npx vitest run tests/owner-history-error-source.test.ts`

Expected: FAIL before adapter; PASS after adapter.

Run: `npx vitest run tests/owner-broadcast-domain.test.ts tests/owner-broadcast-source.test.ts tests/owner-history-error-source.test.ts && npx tsc --noEmit && npm run lint && npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: all exit `0`, serially.

- [ ] **Step 6: Commit UI and history adapter**

```bash
git add src/routes/super-admin/broadcast.tsx src/lib/owner-history.server.ts tests/owner-broadcast-source.test.ts tests/owner-history-error-source.test.ts
git commit -m "feat: add owner broadcast console"
```

## Plan Self-Review

- [x] Covers selected and all active scope, server-side eligibility, exact confirmation, preview counts, bounds/rate limits, command per device, partial tenant results, and delivery outcome classes.
- [x] Broadcast history adapter lands in this plan only after migration creates broadcast tables; 6E retains parent rows.
