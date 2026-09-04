# Crew Occupancy Realtime Notice + Compact Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every table status change (crew or customer) as a sticky, auto-rotating notice in the crew header, and re-layout `CrewHeader` into one compact row + a notice row, with the restaurant code shown beside the logo.

**Architecture:** Enrich the existing private realtime broadcast payload (`kind`/`actor_role`/`actor_name`/`actor_role_session_id`) via a new migration redefining the 6 occupancy RPCs; the shared realtime hook parses it and emits non-self notices into a FIFO 2s queue rendered by `CrewHeader`. Restaurant code is plumbed from `loginToRestaurant` into `RoleSessionIdentity`.

**Tech Stack:** TypeScript (ESM, `esModuleInterop:false` -> named imports), TanStack Start, React 19, Vitest (plain-controller testing, no React Testing Library), Supabase Postgres security-definer RPCs + `realtime.send` broadcast.

**Binding rules (repo AGENTS.md):** strict TDD (MERAH -> HIJAU), `npm run verify` exit 0 before every commit+push, never edit an applied migration, distinguish repo migration filename from Supabase ledger version.

Spec: `docs/superpowers/specs/2026-09-04-crew-occupancy-toast-design.md`

---

## File Structure

- Create `src/lib/restaurant-label.ts` — pure `formatRestaurantLabel`.
- Create `src/lib/occupancy-notice.ts` — pure `parseOccupancyBroadcast`, `formatOccupancyNotice`, types, `ROLE_PILL_LABEL`.
- Create `src/lib/notice-queue.ts` — plain `createNoticeQueue` controller (FIFO, 2s, injectable timer).
- Create `src/hooks/use-notice-queue.ts` — thin React wrapper over `createNoticeQueue`.
- Edit `src/hooks/use-table-occupancy-realtime.ts` — add `selfRoleSessionId` + `onNotice`; parse+notify in `handleInvalidate`.
- Edit `src/lib/crew-session-identity.ts` — optional `restaurantCode` on `RoleSessionIdentity`.
- Edit `src/lib/restaurants.server.ts` — `loginToRestaurant` returns `code`.
- Edit `src/components/RoleLoginFlow.tsx` — carry `code` into `RoleSessionIdentity.restaurantCode`.
- Edit `src/components/CrewHeader.tsx` — compact row 1 + notice row 2 + `restaurantCode`/`notice` props.
- Edit `src/routes/{kasir,satgas,clear-up}/index.tsx` — wire queue + hook args + header props.
- Create `supabase/migrations/20260904090000_occupancy_notice_payload.sql` — redefine 6 RPCs with enriched payload.
- Tests: new `restaurant-label`, `occupancy-notice`, `notice-queue`, `crew-header-notice`, `occupancy-notice-migration`, `crew-login-code`; extend `use-table-occupancy-realtime`, `crew-session-identity`.

Note: `tests/table-occupancy-realtime-broadcast.test.ts` and
`tests/private-table-occupancy-realtime-migration.test.ts` read HISTORICAL
migration files that this plan does not edit, so they stay green untouched.

---

## Task 1: `restaurant-label.ts` (pure)

**Files:**
- Create: `src/lib/restaurant-label.ts`
- Test: `tests/restaurant-label.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/restaurant-label.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatRestaurantLabel } from "../src/lib/restaurant-label";

describe("formatRestaurantLabel", () => {
  it("prefixes the code and strips the chain brand", () => {
    expect(formatRestaurantLabel("CKRBUL", "Mie Gacoan Kampung Bulu")).toBe(
      "CKRBUL - Kampung Bulu",
    );
  });
  it("omits the code separator when no code", () => {
    expect(formatRestaurantLabel("", "Mie Gacoan Kampung Bulu")).toBe("Kampung Bulu");
  });
  it("keeps a name that does not start with the brand", () => {
    expect(formatRestaurantLabel("ABC", "Warung Nusantara")).toBe("ABC - Warung Nusantara");
  });
  it("falls back to the full name when stripping empties it", () => {
    expect(formatRestaurantLabel("MG", "Mie Gacoan")).toBe("MG - Mie Gacoan");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/restaurant-label.test.ts`
Expected: FAIL — cannot resolve `../src/lib/restaurant-label`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/restaurant-label.ts`:
```ts
// Compact crew-header restaurant label: "{CODE} - {BRANCH}" where BRANCH drops a
// leading "Mie Gacoan" chain prefix. Casing is left to the header's uppercase
// class. Falls back to the full display name if stripping would empty it.
export function formatRestaurantLabel(code: string, displayName: string): string {
  const trimmed = (displayName ?? "").trim();
  const branch = trimmed.replace(/^\s*mie\s+gacoan\s+/i, "").trim() || trimmed;
  const c = (code ?? "").trim();
  return c ? `${c} - ${branch}` : branch;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/restaurant-label.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/restaurant-label.ts tests/restaurant-label.test.ts
git commit -m "feat: add compact restaurant label formatter (code - branch)"
```

---

## Task 2: `occupancy-notice.ts` (pure parse + format)

**Files:**
- Create: `src/lib/occupancy-notice.ts`
- Test: `tests/occupancy-notice.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/occupancy-notice.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  formatOccupancyNotice,
  parseOccupancyBroadcast,
} from "../src/lib/occupancy-notice";

const FULL = {
  payload: {
    table_number: 5,
    revision: 9,
    kind: "occupied",
    actor_role: "kasir",
    actor_name: "Budi",
    actor_role_session_id: "sess-budi",
  },
};

describe("parseOccupancyBroadcast", () => {
  it("accepts a full enriched payload", () => {
    expect(parseOccupancyBroadcast(FULL)).toEqual({
      table_number: 5,
      revision: 9,
      kind: "occupied",
      actor_role: "kasir",
      actor_name: "Budi",
      actor_role_session_id: "sess-budi",
    });
  });
  it("rejects a legacy invalidate hint (no kind)", () => {
    expect(parseOccupancyBroadcast({ payload: { table_number: 5, revision: 9 } })).toBeNull();
  });
  it("rejects malformed fields", () => {
    expect(parseOccupancyBroadcast(null)).toBeNull();
    expect(parseOccupancyBroadcast({ payload: { ...FULL.payload, kind: "nope" } })).toBeNull();
    expect(parseOccupancyBroadcast({ payload: { ...FULL.payload, table_number: "5" } })).toBeNull();
  });
  it("treats missing actor name/session as null (customer scan)", () => {
    const parsed = parseOccupancyBroadcast({
      payload: { ...FULL.payload, actor_role: "qr_scan", actor_name: null, actor_role_session_id: null },
    });
    expect(parsed?.actor_name).toBeNull();
    expect(parsed?.actor_role_session_id).toBeNull();
  });
});

describe("formatOccupancyNotice", () => {
  const b = parseOccupancyBroadcast(FULL)!;
  it("kasir occupy", () => {
    expect(formatOccupancyNotice(b)).toEqual({
      line1: "MEJA 5 TERISI",
      roleLabel: "KASIR",
      actorName: "Budi",
    });
  });
  it("clear up cleaned", () => {
    expect(
      formatOccupancyNotice({ ...b, kind: "cleared", actor_role: "clear_up", actor_name: "Sari" }),
    ).toEqual({ line1: "MEJA 5 SUDAH DIBERSIHKAN", roleLabel: "C.U", actorName: "Sari" });
  });
  it("satgas escorted", () => {
    expect(formatOccupancyNotice({ ...b, kind: "escorted", actor_role: "satgas", actor_name: "Andi" })).toEqual({
      line1: "MEJA 5 DIESCORT",
      roleLabel: "SATGAS",
      actorName: "Andi",
    });
  });
  it("customer decline has no actor name", () => {
    expect(
      formatOccupancyNotice({
        ...b,
        kind: "cancelled",
        actor_role: "qr_scan",
        actor_name: null,
        actor_role_session_id: null,
      }),
    ).toEqual({ line1: "MEJA 5 DIBATALKAN", roleLabel: "SCAN QR", actorName: null });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/occupancy-notice.test.ts`
Expected: FAIL — cannot resolve `../src/lib/occupancy-notice`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/occupancy-notice.ts`:
```ts
export type OccupancyKind = "occupied" | "cleared" | "escorted" | "cancelled";
export type OccupancyActorRole = "kasir" | "clear_up" | "satgas" | "qr_scan";

export type OccupancyBroadcast = {
  table_number: number;
  revision: number;
  kind: OccupancyKind;
  actor_role: OccupancyActorRole;
  actor_name: string | null;
  actor_role_session_id: string | null;
};

export type OccupancyNotice = { line1: string; roleLabel: string; actorName: string | null };

const KIND_LINE1: Record<OccupancyKind, string> = {
  occupied: "TERISI",
  cleared: "SUDAH DIBERSIHKAN",
  escorted: "DIESCORT",
  cancelled: "DIBATALKAN",
};

export const ROLE_PILL_LABEL: Record<OccupancyActorRole, string> = {
  kasir: "KASIR",
  clear_up: "C.U",
  satgas: "SATGAS",
  qr_scan: "SCAN QR",
};

const KINDS = new Set<string>(Object.keys(KIND_LINE1));
const ROLES = new Set<string>(Object.keys(ROLE_PILL_LABEL));

export function parseOccupancyBroadcast(message: unknown): OccupancyBroadcast | null {
  if (!message || typeof message !== "object") return null;
  const payload = (message as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.table_number !== "number" || !Number.isInteger(p.table_number)) return null;
  if (typeof p.revision !== "number" || !Number.isSafeInteger(p.revision)) return null;
  if (typeof p.kind !== "string" || !KINDS.has(p.kind)) return null;
  if (typeof p.actor_role !== "string" || !ROLES.has(p.actor_role)) return null;
  return {
    table_number: p.table_number,
    revision: p.revision,
    kind: p.kind as OccupancyKind,
    actor_role: p.actor_role as OccupancyActorRole,
    actor_name: typeof p.actor_name === "string" ? p.actor_name : null,
    actor_role_session_id:
      typeof p.actor_role_session_id === "string" ? p.actor_role_session_id : null,
  };
}

export function formatOccupancyNotice(b: OccupancyBroadcast): OccupancyNotice | null {
  const head = KIND_LINE1[b.kind];
  const roleLabel = ROLE_PILL_LABEL[b.actor_role];
  if (!head || !roleLabel) return null;
  return { line1: `MEJA ${b.table_number} ${head}`, roleLabel, actorName: b.actor_name };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/occupancy-notice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/occupancy-notice.ts tests/occupancy-notice.test.ts
git commit -m "feat: parse and format occupancy notice broadcasts"
```

---

## Task 3: `notice-queue.ts` (plain FIFO controller) + React wrapper

**Files:**
- Create: `src/lib/notice-queue.ts`
- Create: `src/hooks/use-notice-queue.ts`
- Test: `tests/notice-queue.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/notice-queue.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNoticeQueue } from "../src/lib/notice-queue";
import type { OccupancyNotice } from "../src/lib/occupancy-notice";

const notice = (n: number): OccupancyNotice => ({
  line1: `MEJA ${n} TERISI`,
  roleLabel: "KASIR",
  actorName: "Budi",
});

describe("createNoticeQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the first push immediately and clears after the interval", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ intervalMs: 2000, onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    expect(shown).toEqual([notice(1)]);
    vi.advanceTimersByTime(2000);
    expect(shown.at(-1)).toBeNull();
  });

  it("plays a burst oldest-first, one at a time, dropping nothing", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ intervalMs: 2000, onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    queue.push(notice(2));
    queue.push(notice(3));
    expect(shown).toEqual([notice(1)]);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    vi.advanceTimersByTime(2000);
    expect(shown).toEqual([notice(1), notice(2), notice(3), null]);
  });

  it("dispose stops further callbacks", () => {
    const shown: Array<OccupancyNotice | null> = [];
    const queue = createNoticeQueue({ intervalMs: 2000, onShow: (n) => shown.push(n) });
    queue.push(notice(1));
    queue.dispose();
    vi.advanceTimersByTime(2000);
    expect(shown).toEqual([notice(1)]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/notice-queue.test.ts`
Expected: FAIL — cannot resolve `../src/lib/notice-queue`.

- [ ] **Step 3: Write the controller**

Create `src/lib/notice-queue.ts`:
```ts
import type { OccupancyNotice } from "./occupancy-notice";

export type NoticeQueue = {
  push: (notice: OccupancyNotice) => void;
  dispose: () => void;
};

// FIFO ticker: shows one notice at a time for intervalMs, oldest first, never
// dropping. Mirrors the realtime controller's injectable-timer style so it is
// unit-testable without React.
export function createNoticeQueue({
  intervalMs = 2000,
  onShow,
  setIntervalFn = (handler: () => void, ms: number) => setTimeout(handler, ms),
  clearTimeoutFn = (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
}: {
  intervalMs?: number;
  onShow: (notice: OccupancyNotice | null) => void;
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}): NoticeQueue {
  const queue: OccupancyNotice[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let showing = false;
  let disposed = false;

  function advance() {
    if (disposed) return;
    const next = queue.shift() ?? null;
    if (next) {
      showing = true;
      onShow(next);
      timer = setIntervalFn(advance, intervalMs);
    } else {
      showing = false;
      onShow(null);
      timer = null;
    }
  }

  return {
    push(notice) {
      if (disposed) return;
      queue.push(notice);
      if (!showing) advance();
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeoutFn(timer);
      timer = null;
    },
  };
}
```

- [ ] **Step 4: Write the React wrapper**

Create `src/hooks/use-notice-queue.ts`:
```ts
import { useEffect, useMemo, useState } from "react";
import { createNoticeQueue } from "../lib/notice-queue";
import type { OccupancyNotice } from "../lib/occupancy-notice";

export function useNoticeQueue(intervalMs = 2000) {
  const [current, setCurrent] = useState<OccupancyNotice | null>(null);
  const queue = useMemo(
    () => createNoticeQueue({ intervalMs, onShow: setCurrent }),
    [intervalMs],
  );
  useEffect(() => () => queue.dispose(), [queue]);
  return { push: queue.push, current };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run tests/notice-queue.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notice-queue.ts src/hooks/use-notice-queue.ts tests/notice-queue.test.ts
git commit -m "feat: add FIFO occupancy notice queue controller and hook"
```

---

## Task 4: Realtime hook emits non-self notices

**Files:**
- Modify: `src/hooks/use-table-occupancy-realtime.ts`
- Test: `tests/use-table-occupancy-realtime.test.ts` (extend)

- [ ] **Step 1: Write the failing tests (MERAH)**

In `tests/use-table-occupancy-realtime.test.ts`, extend `fakeChannel()`'s returned object (the block ending near line 35) to also expose a raw emitter. Add to the returned object:
```ts
    emitRaw: (message: unknown) => broadcastCallback?.(message),
```

Then append a new describe block at the end of the file:
```ts
describe("occupancy notice emission", () => {
  const enriched = (over: Record<string, unknown> = {}) => ({
    payload: {
      table_number: 5,
      revision: 99,
      kind: "occupied",
      actor_role: "kasir",
      actor_name: "Budi",
      actor_role_session_id: "sess-budi",
      ...over,
    },
  });

  it("calls onNotice for a non-self status change and still refetches", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    const onNotice = vi.fn();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch,
      selfRoleSessionId: "sess-me",
      onNotice,
    });
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitRaw(enriched());
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(onNotice.mock.calls[0][0]).toMatchObject({ kind: "occupied", actor_role: "kasir" });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("suppresses the notice for the actor's own session but still refetches", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    const onNotice = vi.fn();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch,
      selfRoleSessionId: "sess-budi",
      onNotice,
    });
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitRaw(enriched());
    expect(onNotice).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("never calls onNotice for a legacy invalidate hint", () => {
    const { client, channels } = fakeClient();
    const onNotice = vi.fn();
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      sessionToken: SESSION_TOKEN,
      refetch: vi.fn(),
      selfRoleSessionId: "sess-me",
      onNotice,
    });
    channels.get(`table-occupancy:${RESTAURANT_ID}`)!.emitInvalidate(7);
    expect(onNotice).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/use-table-occupancy-realtime.test.ts`
Expected: FAIL — `onNotice` never called (controller ignores the new deps).

- [ ] **Step 3: Implement**

In `src/hooks/use-table-occupancy-realtime.ts`:

Add the import near the top (after the supabase-browser import):
```ts
import { parseOccupancyBroadcast, type OccupancyBroadcast } from "../lib/occupancy-notice";
```

In the `createTableOccupancyRealtimeController` parameter destructure (around line 67-89), add two deps:
```ts
  selfRoleSessionId = null,
  onNotice,
```
and to its parameter type object:
```ts
  selfRoleSessionId?: string | null;
  onNotice?: (broadcast: OccupancyBroadcast) => void;
```

At the very top of `handleInvalidate` (before the existing `if (!message ...)` guard), insert:
```ts
    const broadcast = parseOccupancyBroadcast(message);
    if (broadcast && broadcast.actor_role_session_id !== selfRoleSessionId) {
      onNotice?.(broadcast);
    }
```

Update the `useTableOccupancyRealtime` wrapper (line 189) to accept and forward the two new args WITHOUT adding them to the effect deps (an inline `onNotice` from the page would otherwise re-subscribe the channel every render). Mirror the existing `refetchRef` pattern:

```ts
export function useTableOccupancyRealtime(
  restaurantId: string,
  sessionToken: string,
  revision: number | null,
  refetch: () => void,
  selfRoleSessionId?: string | null,
  onNotice?: (broadcast: OccupancyBroadcast) => void,
) {
  const [status, setStatus] = useState<TableOccupancyRealtimeStatus>("SUBSCRIBING");
  const refetchRef = useRef(refetch);
  const revisionRef = useRef(revision);
  const onNoticeRef = useRef(onNotice);
  refetchRef.current = refetch;
  revisionRef.current = revision;
  onNoticeRef.current = onNotice;

  useEffect(() => {
    const client = getSupabaseBrowserClient() as unknown as SupabaseClientLike | null;
    const controller = createTableOccupancyRealtimeController({
      client,
      restaurantId,
      sessionToken,
      refetch: () => refetchRef.current(),
      getCurrentRevision: () => revisionRef.current,
      onStatusChange: setStatus,
      visibility: browserVisibilitySource(),
      selfRoleSessionId: selfRoleSessionId ?? null,
      onNotice: (broadcast) => onNoticeRef.current?.(broadcast),
    });
    return () => controller.dispose();
  }, [restaurantId, sessionToken]);

  return status;
}
```

`selfRoleSessionId` is captured at subscribe time (it is stable for the life of a
role session), so it does not need a ref and must NOT be added to the deps array.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/use-table-occupancy-realtime.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-table-occupancy-realtime.ts tests/use-table-occupancy-realtime.test.ts
git commit -m "feat: emit non-self occupancy notices from the realtime hook"
```

---

## Task 5: `restaurantCode` on the role session identity

**Files:**
- Modify: `src/lib/crew-session-identity.ts`
- Test: `tests/crew-session-identity.test.ts` (extend)

- [ ] **Step 1: Update the failing test (MERAH)**

In `tests/crew-session-identity.test.ts`, add `restaurantCode` to the `roleFields` fixture (lines 102-112):
```ts
    restaurantCode: "CKRBUL",
```
Then append a new test inside the `describe("role session identity", ...)` block:
```ts
  it("defaults restaurantCode to empty for pre-existing sessions", () => {
    const stored = { ...roleFields } as Record<string, unknown>;
    delete stored.restaurantCode;
    const session = storage({ "table-talker.role-identity": JSON.stringify(stored) });
    const read = readRoleSessionIdentity(session);
    expect(read).not.toBeNull();
    expect(read?.restaurantCode).toBe("");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/crew-session-identity.test.ts`
Expected: FAIL — `restaurantCode` not on the type / not returned.

- [ ] **Step 3: Implement**

In `src/lib/crew-session-identity.ts`:

Add to the `RoleSessionIdentity` type (after `restaurantDisplayName: string;`):
```ts
  restaurantCode: string;
```

In `readRoleSessionIdentity`, add to the parsed-value type (near line 156):
```ts
      restaurantCode?: unknown;
```
and to the returned object (near line 185), treat it as OPTIONAL (never clears the session):
```ts
      restaurantCode: typeof value.restaurantCode === "string" ? value.restaurantCode : "",
```
(Do NOT add `restaurantCode` to the required-field validation block, so pre-existing sessions without it still read back.)

`writeRoleSessionIdentity` already persists the whole object via `JSON.stringify(identity)`, so no change is needed there.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/crew-session-identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/crew-session-identity.ts tests/crew-session-identity.test.ts
git commit -m "feat: carry optional restaurantCode on the role session identity"
```

---

## Task 6: Plumb the restaurant code through login

**Files:**
- Modify: `src/lib/restaurants.server.ts:49-54`
- Modify: `src/components/RoleLoginFlow.tsx` (LoginResult type, setLogin, onRoleContinue)
- Test: `tests/crew-login-code.test.ts`

- [ ] **Step 1: Write the failing contract test (MERAH)**

Create `tests/crew-login-code.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = () =>
  readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");
const flow = () =>
  readFileSync(new URL("../src/components/RoleLoginFlow.tsx", import.meta.url), "utf8");

describe("restaurant code plumbing", () => {
  it("loginToRestaurant returns the validated code", () => {
    expect(server()).toMatch(/restaurantId:\s*login\.p_rid,[\s\S]*code:\s*validated\.code/);
  });
  it("RoleLoginFlow stores the code as restaurantCode on the role identity", () => {
    expect(flow()).toContain("restaurantCode: login.code");
    expect(flow()).toMatch(/type LoginResult = \{[\s\S]*code: string;/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/crew-login-code.test.ts`
Expected: FAIL — `code` not returned / not stored.

- [ ] **Step 3: Implement**

In `src/lib/restaurants.server.ts`, extend the success return (lines 49-54):
```ts
      return {
        ok: true as const,
        restaurantId: login.p_rid,
        displayName: login.p_rname,
        code: validated.code,
        tenantToken,
      };
```

In `src/components/RoleLoginFlow.tsx`:

`LoginResult` type (lines 58-62):
```ts
type LoginResult = {
  restaurantId: string;
  displayName: string;
  code: string;
  tenantToken: string;
};
```

`setLogin({...})` (lines 147-151):
```ts
      setLogin({
        restaurantId: result.restaurantId,
        displayName: result.displayName,
        code: result.code,
        tenantToken: result.tenantToken,
      });
```

`onRoleContinue({...})` (lines 237-247) — add `restaurantCode`:
```ts
      onRoleContinue({
        restaurantId: login.restaurantId,
        restaurantDisplayName: login.displayName,
        restaurantCode: login.code,
        tenantToken: login.tenantToken,
        role,
        displayName: result.displayName,
        checkedInAt: result.checkedInAt,
        roleSessionId: result.sessionId,
        roleSessionToken: result.sessionToken,
        accessToken,
      });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/crew-login-code.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/restaurants.server.ts src/components/RoleLoginFlow.tsx tests/crew-login-code.test.ts
git commit -m "feat: return and store the restaurant code at crew login"
```

---

## Task 7: Re-layout `CrewHeader` (compact row + notice slot)

**Files:**
- Modify: `src/components/CrewHeader.tsx`
- Test: `tests/crew-header-notice.test.ts`

- [ ] **Step 1: Write the failing contract test (MERAH)**

Create `tests/crew-header-notice.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/CrewHeader.tsx", import.meta.url), "utf8");

describe("CrewHeader compact layout + notice slot", () => {
  it("accepts restaurantCode and notice props", () => {
    const file = source();
    expect(file).toContain("restaurantCode");
    expect(file).toContain("notice");
    expect(file).toContain("formatRestaurantLabel");
  });
  it("renders the magenta notice box and cyan role pill", () => {
    const file = source();
    expect(file).toContain("bg-fuchsia-50");
    expect(file).toContain("bg-cyan-600");
  });
  it("keeps the header sticky", () => {
    expect(source()).toContain("sticky top-0");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/crew-header-notice.test.ts`
Expected: FAIL — no `restaurantCode`/`notice`/`bg-fuchsia-50`.

- [ ] **Step 3: Implement**

Replace the `CrewHeader` function (lines 30-79) of `src/components/CrewHeader.tsx` with:
```tsx
export function CrewHeader({
  role,
  restaurantName,
  restaurantCode,
  userName,
  onLogout,
  notice,
}: {
  role: string;
  restaurantName?: string;
  restaurantCode?: string;
  userName: string;
  onLogout: () => void;
  notice?: OccupancyNotice | null;
}) {
  const label = formatRestaurantLabel(restaurantCode ?? "", restaurantName ?? "");
  return (
    <header className="sticky top-0 z-30 overflow-hidden rounded-2xl border border-slate-200 bg-white/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85">
      <div className="flex items-center justify-between gap-3 px-5 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/lime-logo.webp" alt="LIME" className="h-6 w-auto shrink-0 select-none sm:h-7" />
          <span className="min-w-0 truncate text-[11px] font-extrabold uppercase tracking-wide text-lime-800 sm:text-xs">
            {label}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="flex flex-col items-end">
            <span className="max-w-[7rem] truncate text-xs font-bold uppercase text-slate-600 sm:max-w-[12rem]">
              {userName}
            </span>
            <span className="mt-0.5 inline-flex shrink-0 items-center rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white sm:text-[10px]">
              {role}
            </span>
          </div>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Keluar"
            title="Keluar"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-red-600 bg-red-600 text-white transition hover:border-red-700 hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>

      <div className="px-5 pb-2 sm:px-6">
        <div className="flex min-h-[2.75rem] flex-col justify-center rounded-xl bg-fuchsia-50 px-3 py-1.5 ring-1 ring-inset ring-fuchsia-200">
          {notice ? (
            <>
              <p className="truncate text-sm font-extrabold uppercase text-fuchsia-900">
                {notice.line1}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-fuchsia-800">
                <span className="text-[10px] font-bold uppercase text-fuchsia-500">BY</span>
                <span className="inline-flex items-center rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  {notice.roleLabel}
                </span>
                {notice.actorName ? <span>: {notice.actorName}</span> : null}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
```

Add the imports at the top of the file (after the existing `lucide-react` import):
```tsx
import { formatRestaurantLabel } from "../lib/restaurant-label";
import type { OccupancyNotice } from "../lib/occupancy-notice";
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/crew-header-notice.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/CrewHeader.tsx tests/crew-header-notice.test.ts
git commit -m "feat(ui): compact crew header with sticky occupancy notice slot"
```

---

## Task 8: Wire notices + code into the 3 crew pages

**Files:**
- Modify: `src/routes/kasir/index.tsx`
- Modify: `src/routes/satgas/index.tsx`
- Modify: `src/routes/clear-up/index.tsx`
- Test: `tests/crew-pages-notice.test.ts`

- [ ] **Step 1: Write the failing contract test (MERAH)**

Create `tests/crew-pages-notice.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = ["kasir", "satgas", "clear-up"];

describe("crew pages wire notices + restaurant code", () => {
  for (const page of pages) {
    it(`${page} passes restaurantCode + notice and uses the queue`, () => {
      const file = readFileSync(
        new URL(`../src/routes/${page}/index.tsx`, import.meta.url),
        "utf8",
      );
      expect(file).toContain("useNoticeQueue");
      expect(file).toContain("restaurantCode={identity.restaurantCode}");
      expect(file).toContain("notice={notices.current}");
      expect(file).toContain("formatOccupancyNotice");
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/crew-pages-notice.test.ts`
Expected: FAIL — pages don't reference the queue yet.

- [ ] **Step 3: Implement (same 3 edits per page)**

For EACH of `kasir`, `satgas`, `clear-up` `index.tsx`:

Add imports (near the other `@/lib` / `@/hooks` imports):
```ts
import { useNoticeQueue } from "@/hooks/use-notice-queue";
import { formatOccupancyNotice } from "@/lib/occupancy-notice";
```

Add the queue next to the other hooks (e.g. after `useLayoutPreference`):
```ts
  const notices = useNoticeQueue();
```

Extend the `useTableOccupancyRealtime(...)` call to pass the two new args. Replace the existing 4-arg call:
```ts
  const realtimeStatus = useTableOccupancyRealtime(
    restaurantId,
    identity?.roleSessionToken ?? "",
    snapshot.data?.ok ? snapshot.data.revision : null,
    () => {
      void queryClient.invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) });
    },
    identity?.roleSessionId ?? null,
    (broadcast) => {
      const notice = formatOccupancyNotice(broadcast);
      if (notice) notices.push(notice);
    },
  );
```

Extend the `<CrewHeader ... />` render with the two new props:
```tsx
        <CrewHeader
          role="Kasir"
          restaurantName={identity.restaurantDisplayName}
          restaurantCode={identity.restaurantCode}
          userName={identity.displayName}
          onLogout={logout}
          notice={notices.current}
        />
```
(Use each page's existing `role` string: `"Kasir"`, `"Satgas"`, `"Clear Up"`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/crew-pages-notice.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/kasir/index.tsx src/routes/satgas/index.tsx src/routes/clear-up/index.tsx tests/crew-pages-notice.test.ts
git commit -m "feat(ui): show occupancy notices and restaurant code on crew pages"
```

---

## Task 9: Migration — enriched broadcast payload (6 RPCs)

**Files:**
- Create: `supabase/migrations/20260904090000_occupancy_notice_payload.sql`
- Test: `tests/occupancy-notice-migration.test.ts`

- [ ] **Step 1: Write the failing contract test (MERAH)**

Create `tests/occupancy-notice-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const url = new URL(
  "../supabase/migrations/20260904090000_occupancy_notice_payload.sql",
  import.meta.url,
);
const source = () => readFileSync(url, "utf8").toLowerCase();

describe("occupancy notice payload migration", () => {
  it("redefines all six broadcast rpcs", () => {
    const sql = source();
    for (const fn of [
      "set_table_occupied_kasir",
      "set_table_empty_cleanup",
      "create_escort_intent",
      "confirm_escort_intent",
      "record_qr_scan",
      "decline_qr_scan",
    ]) {
      expect(sql).toContain(`create or replace function public.${fn}(`);
    }
  });

  it("adds kind/actor fields to every send", () => {
    const sql = source();
    expect(sql).toContain("'kind'");
    expect(sql).toContain("'actor_role'");
    expect(sql).toContain("'actor_name'");
    expect(sql).toContain("'actor_role_session_id'");
    expect(sql).toContain("crew_role_sessions crs");
  });

  it("keeps the private send flag and invalidate event", () => {
    const sql = source();
    const sends = sql.match(/perform realtime\.send\([\s\S]*?\n\s*\);/g) ?? [];
    expect(sends.length).toBeGreaterThanOrEqual(6);
    for (const s of sends) {
      expect(s).toContain("'invalidate'");
      expect(s).toMatch(/,\s*true\s*\)/);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/occupancy-notice-migration.test.ts`
Expected: FAIL — ENOENT on the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260904090000_occupancy_notice_payload.sql`. Each function is the CURRENT deployed body (fetched via `pg_get_functiondef`) with ONLY the `realtime.send` jsonb enriched (plus a `v_actor_name` lookup for the 4 crew RPCs). Status/revision/escort behavior is unchanged. ACLs are preserved by `CREATE OR REPLACE` (no grant changes here).

```sql
-- Enrich the private occupancy broadcast with a human-readable notice payload
-- (kind + actor) so crew UIs can show "what changed / who did it". Status,
-- revision-bump, escort, and debounce behavior are unchanged from the deployed
-- definitions; only the realtime.send jsonb is extended.

create or replace function public.set_table_occupied_kasir(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_revision bigint;
  v_actor_name text;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'kasir'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'kasir')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi', occupied_at = now(), occupied_source = 'kasir', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if found then
    update public.table_escort_intents set resolved = true
    where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    select crs.display_name into v_actor_name from public.crew_role_sessions crs
      where crs.id = v_session.role_session_id;
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
        'kind', 'occupied', 'actor_role', 'kasir',
        'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
      'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
    );
  end if;
end;
$$;

create or replace function public.set_table_empty_cleanup(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_revision bigint;
  v_actor_name text;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'clear_up'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'kosong', null, null)
  on conflict (restaurant_id, table_number) do update set
    status = 'kosong', occupied_at = null, occupied_source = null, updated_at = now()
  where public.table_occupancy_state.status = 'terisi';

  if found then
    update public.table_escort_intents set resolved = true
    where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    select crs.display_name into v_actor_name from public.crew_role_sessions crs
      where crs.id = v_session.role_session_id;
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
        'kind', 'cleared', 'actor_role', 'clear_up',
        'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
      'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
    );
  end if;
end;
$$;

create or replace function public.create_escort_intent(
  p_restaurant_id uuid,
  p_table_number integer,
  p_session_token text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_existing record;
  v_existing_actor uuid;
  v_id uuid;
  v_revision bigint;
  v_actor_name text;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.restaurant_id = p_restaurant_id
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;

  select * into v_existing
  from public.table_escort_intents
  where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false
  for update;

  if v_existing is not null then
    if v_existing.actor_session_id = v_session.role_session_id then
      return v_existing.id;
    else
      raise exception 'ALREADY_ESCORTED';
    end if;
  end if;

  begin
    insert into public.table_escort_intents (restaurant_id, table_number, actor_session_id, expires_at)
    values (p_restaurant_id, p_table_number, v_session.role_session_id, now() + interval '10 minutes')
    returning id into v_id;
  exception
    when unique_violation then
      select id, actor_session_id into v_id, v_existing_actor
      from public.table_escort_intents
      where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;
      if v_existing_actor = v_session.role_session_id then
        return v_id;
      else
        raise exception 'ALREADY_ESCORTED';
      end if;
  end;

  v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
  select crs.display_name into v_actor_name from public.crew_role_sessions crs
    where crs.id = v_session.role_session_id;
  perform realtime.send(
    jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
      'kind', 'escorted', 'actor_role', 'satgas',
      'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
    'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
  );
  return v_id;
end;
$$;

create or replace function public.confirm_escort_intent(
  p_intent_id uuid,
  p_session_token text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_intent record;
  v_revision bigint;
  v_actor_name text;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_intent
  from public.table_escort_intents
  where id = p_intent_id and restaurant_id = v_session.restaurant_id
    and actor_session_id = v_session.role_session_id
    and expires_at <= now() and resolved = false;
  if v_intent is null then raise exception 'INTENT_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id and table_number = v_intent.table_number and status = 'kosong'
  ) and exists (
    select 1 from public.table_occupancy_state
    where restaurant_id = v_intent.restaurant_id and table_number = v_intent.table_number
  ) then raise exception 'ALREADY_OCCUPIED'; end if;

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (v_intent.restaurant_id, v_intent.table_number, 'terisi', now(), 'satgas_escort')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi', occupied_at = now(), occupied_source = 'satgas_escort', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if not found then raise exception 'ALREADY_OCCUPIED'; end if;

  update public.table_escort_intents set resolved = true where id = p_intent_id;
  v_revision := public.bump_table_occupancy_revision(v_intent.restaurant_id);
  select crs.display_name into v_actor_name from public.crew_role_sessions crs
    where crs.id = v_session.role_session_id;
  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number, 'revision', v_revision,
      'kind', 'occupied', 'actor_role', 'satgas',
      'actor_name', v_actor_name, 'actor_role_session_id', v_session.role_session_id),
    'invalidate', 'table-occupancy:' || v_intent.restaurant_id::text, true
  );
end;
$$;

create or replace function public.record_qr_scan(
  p_restaurant_id uuid,
  p_table_number integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'; end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant_id and is_active) then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  insert into public.qr_scan_events (restaurant_id, table_number)
  values (p_restaurant_id, p_table_number);

  insert into public.table_occupancy_state (restaurant_id, table_number, status, occupied_at, occupied_source)
  values (p_restaurant_id, p_table_number, 'terisi', now(), 'qr_scan')
  on conflict (restaurant_id, table_number) do update set
    status = 'terisi', occupied_at = now(), occupied_source = 'qr_scan', updated_at = now()
  where public.table_occupancy_state.status = 'kosong';

  if found then
    update public.table_escort_intents set resolved = true
    where restaurant_id = p_restaurant_id and table_number = p_table_number and resolved = false;

    v_revision := public.bump_table_occupancy_revision(p_restaurant_id);
    perform realtime.send(
      jsonb_build_object('table_number', p_table_number, 'revision', v_revision,
        'kind', 'occupied', 'actor_role', 'qr_scan',
        'actor_name', null, 'actor_role_session_id', null),
      'invalidate', 'table-occupancy:' || p_restaurant_id::text, true
    );
  end if;
end;
$$;

create or replace function public.decline_qr_scan(
  p_scan_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan public.pending_qr_scans%rowtype;
  v_revision bigint;
begin
  if p_scan_id is null then return false; end if;

  select * into v_scan
  from public.pending_qr_scans
  where scan_id = p_scan_id and status = 'processed'
    and created_at >= now() - interval '10 minutes'
  for update;
  if not found then return false; end if;

  if exists (
    select 1 from public.qr_scan_events
    where restaurant_id = v_scan.restaurant_id and table_number = v_scan.table_number
      and scanned_at > v_scan.processed_at
  ) then return false; end if;

  update public.table_occupancy_state
  set status = 'kosong', occupied_at = null, occupied_source = null, updated_at = now()
  where restaurant_id = v_scan.restaurant_id and table_number = v_scan.table_number
    and status = 'terisi' and occupied_source = 'qr_scan';
  if not found then return false; end if;

  update public.table_escort_intents set resolved = true
  where restaurant_id = v_scan.restaurant_id and table_number = v_scan.table_number and resolved = false;

  v_revision := public.bump_table_occupancy_revision(v_scan.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_scan.table_number, 'revision', v_revision,
      'kind', 'cancelled', 'actor_role', 'qr_scan',
      'actor_name', null, 'actor_role_session_id', null),
    'invalidate', 'table-occupancy:' || v_scan.restaurant_id::text, true
  );

  update public.pending_qr_scans
  set status = 'terminal', terminal_at = now(), terminal_reason = 'CUSTOMER_DECLINED'
  where scan_id = p_scan_id;

  return true;
end;
$$;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/occupancy-notice-migration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904090000_occupancy_notice_payload.sql tests/occupancy-notice-migration.test.ts
git commit -m "feat(db): enrich occupancy broadcast payload with kind and actor"
```

---

## Task 10: Full gate, apply migration, smoke, push, deploy

**Files:** none new (verification + deploy).

- [ ] **Step 1: Full quality gate**

Run: `npm run verify`
Expected: exit 0. If lint flags CRLF from PowerShell edits, `npx prettier --write` the touched `.ts`/`.tsx` files and re-run.

- [ ] **Step 2: Apply the migration to the Supabase target**

Use Supabase MCP `apply_migration` (name `occupancy_notice_payload`) with the exact SQL from Task 9 Step 3. Record the Supabase-assigned ledger version (differs from the repo filename). Do not re-run if already present.

- [ ] **Step 3: Read-back the enriched sends**

Run via `supabase_execute_sql`:
```sql
SELECT
  (position('actor_role_session_id' in lower(pg_get_functiondef('public.set_table_occupied_kasir(uuid,integer,text)'::regprocedure))) > 0) AS kasir_ok,
  (position("'kind', 'cleared'" in lower(pg_get_functiondef('public.set_table_empty_cleanup(uuid,integer,text)'::regprocedure))) > 0) AS cleanup_ok,
  (position("'kind', 'escorted'" in lower(pg_get_functiondef('public.create_escort_intent(uuid,integer,text)'::regprocedure))) > 0) AS escort_ok,
  (position("'actor_role', 'qr_scan'" in lower(pg_get_functiondef('public.record_qr_scan(uuid,integer)'::regprocedure))) > 0) AS qr_ok,
  (position("'kind', 'cancelled'" in lower(pg_get_functiondef('public.decline_qr_scan(uuid)'::regprocedure))) > 0) AS decline_ok;
```
Expected: all five `true`.

- [ ] **Step 4: Transactional RPC smoke (no production side effects)**

Run via `supabase_execute_sql` (rolled back). Confirms a crew mutation still flips status and the enriched send is well-formed (realtime.send runs inside the txn):
```sql
BEGIN;
-- occupy table 1 as kasir using a real role session token is not available here,
-- so exercise the customer path which needs no session:
perform public.record_qr_scan('33916a05-7e95-42fa-bc3c-050bed2402c5'::uuid, 1);
select status, occupied_source from public.table_occupancy_state
 where restaurant_id='33916a05-7e95-42fa-bc3c-050bed2402c5' and table_number=1;
ROLLBACK;
```
Expected: the SELECT shows `terisi` / `qr_scan` inside the txn (then ROLLBACK discards it). No error from `realtime.send`.

- [ ] **Step 5: Push**

```bash
git push origin main
```

- [ ] **Step 6: Verify CI + Vercel**

Run: `gh api repos/marko1kiro/table-talker-global/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'`
Expected: `db-reset: completed success`.

Run: `vercel ls lihat-meja --json`; confirm the deployment for the new SHA reaches `state: READY`, `target: production`.

- [ ] **Step 7: Report + hand physical test to user**

Ask the user to log in as two crew (e.g. Kasir + Clear Up) on two devices, change a table's status from one, and confirm the OTHER device shows the sticky notice (correct wording + cyan pill) while the acting device does NOT. Confirm the SS station shows no notice and the header is now compact with `CODE - BRANCH`.
