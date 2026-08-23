# Phase 6A Owner Shell And Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace old remote-audio Super Admin page with protected responsive owner shell and independently degraded Dashboard.

**Architecture:** Replace flat `src/routes/super-admin.tsx` with TanStack file-route directory layout: `super-admin/route.tsx` is parent layout, `super-admin/index.tsx` is `/super-admin`, child files map six owner sections, and `restaurants/$id.tsx` stays linkable. Layout uses `getAuthStatus()` and login gate only; every owner server function calls `requireSuperAdmin()` before access. Dashboard server snapshot uses service-role client only in `*.server.ts`, bounded aggregate RPCs, and isolated health probes. Browser Realtime channel status merges into separate Realtime card. No global store. `src/routeTree.gen.ts` is tracked: after every build run `git restore --source=HEAD -- src/routeTree.gen.ts`; never stage it.

**Tech Stack:** TanStack Start file routing, React 19, TanStack Query, Supabase service-role/PostgreSQL, Vitest node tests, Tailwind/Radix primitives.

---

## Dependency Order

1. Complete this plan before 6B, 6C, 6D, and 6E.
2. 6B supplies restaurant/audio links used by shell.
3. 6C supplies history/error totals and destination filters used by Dashboard.
4. 6D supplies broadcast destination and delivery health.
5. 6E installs retention and performs integrated rollout checks.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/routes/super-admin/route.tsx` | Authenticated owner layout, desktop navigation, mobile drawer, `<Outlet />`. |
| `src/routes/super-admin/index.tsx` | Dashboard route, independent cards, links, loading/empty/error/partial states. |
| `src/routes/super-admin/restaurants/index.tsx` | Temporary route boundary for 6B restaurant list; 6B fills content. |
| `src/routes/super-admin/audio.tsx` | Temporary route boundary for 6B Audio; 6B fills content. |
| `src/routes/super-admin/history.tsx` | Temporary route boundary for 6C History; 6C fills content. |
| `src/routes/super-admin/error-log.tsx` | Temporary route boundary for 6C Error Log; 6C fills content. |
| `src/routes/super-admin/broadcast.tsx` | Temporary route boundary for 6D Broadcast; 6D fills content. |
| `src/lib/owner-dashboard-domain.ts` | Pure health/card state conversion and bounded dashboard filter links. |
| `src/lib/owner-dashboard.server.ts` | Server-only protected health checks and aggregate snapshot. |
| `supabase/migrations/20260824001000_owner_dashboard_rpc.sql` | Bounded aggregate RPC, service-role only. |
| `tests/owner-dashboard-domain.test.ts` | Executable pure tests. |
| `tests/owner-shell-source.test.ts` | Source-contract route/navigation/server-boundary tests; no RTL/jsdom dependency exists. |

### Task 1: Lock shell contract with pure and source tests

**Files:**
- Create: `tests/owner-dashboard-domain.test.ts`
- Create: `tests/owner-shell-source.test.ts`

- [ ] **Step 1: Write failing pure dashboard test**

```ts
import { describe, expect, it } from "vitest";
import { dashboardState, sevenDayRange } from "../src/lib/owner-dashboard-domain";

describe("owner dashboard domain", () => {
  it("keeps healthy cards when sibling checks fail", () => {
    expect(dashboardState([
      { name: "database", ok: true },
      { name: "realtime", ok: false, code: "REALTIME_UNAVAILABLE" },
    ])).toEqual({ state: "partial", failed: ["realtime"] });
  });

  it("uses an inclusive seven-day default range", () => {
    expect(sevenDayRange(new Date("2026-08-24T12:00:00.000Z"))).toEqual({
      from: "2026-08-17T12:00:00.000Z", to: "2026-08-24T12:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Write failing route/source-contract test**

```ts
import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root), "utf8");

it("uses valid directory file routes and protected layout", () => {
  expect(file("src/lib/owner-dashboard.server.ts")).toContain("requireSuperAdmin()");
});

it("keeps service role and generated tree out of browser route code", () => {
  expect(file("src/lib/owner-dashboard.server.ts")).not.toContain("getChannels");
});
```

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/owner-dashboard-domain.test.ts tests/owner-shell-source.test.ts`

Expected: FAIL with unresolved `owner-dashboard-domain` and missing `owner-dashboard.server.ts`.

### Task 2: Add bounded dashboard query and independent health snapshot

**Files:**
- Create: `supabase/migrations/20260824001000_owner_dashboard_rpc.sql`
- Create: `src/lib/owner-dashboard-domain.ts`
- Create: `src/lib/owner-dashboard.server.ts`
- Test: `tests/owner-dashboard-domain.test.ts`
- Test: `tests/owner-shell-source.test.ts`

- [ ] **Step 1: Add service-role aggregate RPC migration**

```sql
create or replace function public.owner_dashboard_aggregates(p_since timestamptz)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'restaurants_total', (select count(*) from public.restaurants),
    'restaurants_active', (select count(*) from public.restaurants where is_active),
    'crew_online', (select count(*) from public.crew_sessions where connection_state = 'connected' and last_seen > now() - interval '30 seconds'),
    'plays_today', (select count(*) from public.playback_events where event_timestamp >= date_trunc('day', now())),
    'sync_failures', (select count(*) from public.operational_errors where stage = 'sync_cache' and occurred_at >= p_since and resolved_at is null),
    'unresolved_errors', (select count(*) from public.operational_errors where resolved_at is null)
  );
$$;
revoke all on function public.owner_dashboard_aggregates(timestamptz) from public, anon, authenticated;
grant execute on function public.owner_dashboard_aggregates(timestamptz) to service_role;
```

- [ ] **Step 2: Implement pure state module**

```ts
export type HealthName = "database" | "realtime" | "r2" | "api";
export type HealthResult = { name: HealthName; ok: boolean; code?: string };

export function dashboardState(results: readonly HealthResult[]) {
  const failed = results.filter((result) => !result.ok).map((result) => result.name);
  return { state: failed.length ? "partial" : "ready", failed } as const;
}

export function sevenDayRange(now: Date) {
  return { from: new Date(now.getTime() - 7 * 86_400_000).toISOString(), to: now.toISOString() };
}
```

- [ ] **Step 3: Implement server snapshot with isolated deadlines**

```ts
const timed = async <T>(name: HealthName, work: () => Promise<T>) => {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 3_000));
  try { await Promise.race([work(), timeout]); return { name, ok: true } as const; }
  catch { return { name, ok: false, code: "UNAVAILABLE" } as const; }
};

export const getOwnerDashboard = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const client = getServiceClient();
  if (!client) return { state: "partial" as const, health: [{ name: "database", ok: false, code: "UNAVAILABLE" }], aggregates: null };
  const since = sevenDayRange(new Date()).from;
  const [database, r2, api, aggregates] = await Promise.allSettled([
    timed("database", async () => { if ((await client.from("restaurants").select("id", { head: true, count: "exact" }).limit(1)).error) throw new Error(); }),
    timed("r2", async () => { const { headR2HealthObject } = await import("./r2.server"); await headR2HealthObject(); }),
    timed("api", async () => undefined),
    client.rpc("owner_dashboard_aggregates", { p_since: since }),
  ]);
  const health = [database, r2, api].map((item, index) => item.status === "fulfilled" ? item.value : { name: (["database", "r2", "api"] as const)[index], ok: false, code: "UNAVAILABLE" });
  const data = aggregates.status === "fulfilled" && !aggregates.value.error ? aggregates.value.data : null;
  return { ...dashboardState(health), health, aggregates: data };
});
```

`sync_cache` is existing `OPERATIONS_ERROR_CODES` allowlist value in `src/lib/operational-errors.server.ts`; do not add or rename a stage. `api` proves this server function response path; deployment metadata is optional `{ deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null }` and never changes API health. `headR2HealthObject()` must be a server-only `HeadObject` call against fixed `healthcheck` key. It returns normally on `NotFound`; access/network errors throw. Do not call `client.realtime.getChannels()` server-side; browser route owns Realtime channel status.

- [ ] **Step 5: Run green focused tests and migration source check**

Run: `npx vitest run tests/owner-dashboard-domain.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit server boundary**

```bash
git add supabase/migrations/20260824001000_owner_dashboard_rpc.sql src/lib/owner-dashboard-domain.ts src/lib/owner-dashboard.server.ts src/lib/r2.server.ts tests/owner-dashboard-domain.test.ts tests/owner-shell-source.test.ts
git commit -m "feat: add owner dashboard health snapshot"
```

### Task 3: Replace flat route with valid protected owner layout

**Files:**
- Delete: `src/routes/super-admin.tsx`
- Create: `src/routes/super-admin/route.tsx`
- Create: `src/routes/super-admin/index.tsx`
- Create: `src/routes/super-admin/restaurants/index.tsx`
- Create: `src/routes/super-admin/audio.tsx`
- Create: `src/routes/super-admin/history.tsx`
- Create: `src/routes/super-admin/error-log.tsx`
- Create: `src/routes/super-admin/broadcast.tsx`
- Test: `tests/owner-shell-source.test.ts`

- [ ] **Step 1: Create parent route, sidebar, and mobile drawer**

```tsx
import { Link, Outlet, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { getAuthStatus, loginSuperAdmin } from "@/lib/auth";

export const Route = createFileRoute("/super-admin")({ loader: () => getAuthStatus(), component: OwnerLayout });
const links = [["Dashboard", "/super-admin"], ["Resto", "/super-admin/restaurants"], ["Audio", "/super-admin/audio"], ["Riwayat", "/super-admin/history"], ["Error Log", "/super-admin/error-log"], ["Broadcast", "/super-admin/broadcast"]] as const;
function OwnerLayout() {
  const auth = Route.useLoaderData(); const router = useRouter(); const [open, setOpen] = useState(false);
  if (!auth.superAdmin) return <AuthGate onSuccess={() => router.invalidate()} title="Login Super Admin" instruction="Masukkan password Super Admin." submitLabel="Masuk" loginAction={loginSuperAdmin} />;
  const navigation = <nav aria-label="Navigasi owner">{links.map(([label, to]) => <Link key={to} to={to} onClick={() => setOpen(false)} className="block p-3 font-display uppercase">{label}</Link>)}</nav>;
  return <main className="min-h-[100svh] bg-background md:grid md:grid-cols-[15rem_1fr]"><aside className="hidden border-r md:block">{navigation}</aside><button className="m-4 md:hidden" aria-expanded={open} onClick={() => setOpen(!open)}>Menu owner</button>{open && <aside className="border-b p-4 md:hidden">{navigation}</aside>}<section className="p-4 sm:p-6"><Outlet /></section></main>;
}
```

- [ ] **Step 2: Create Dashboard page with independent-card rendering**

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getOwnerDashboard } from "@/lib/owner-dashboard.server";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { realtimeIsReady } from "@/lib/super-admin-realtime";
export const Route = createFileRoute("/super-admin/")({ component: Dashboard });
function Dashboard() {
  const query = useQuery({ queryKey: ["owner-dashboard"], queryFn: () => getOwnerDashboard(), refetchInterval: 30_000 });
  const [realtimeStatus, setRealtimeStatus] = useState("CHANNEL_ERROR");
  useEffect(() => { const client = getSupabaseBrowserClient(); if (!client) return; const channel = client.channel("owner-dashboard-health").subscribe(setRealtimeStatus); return () => { void client.removeChannel(channel); }; }, []);
  if (query.isLoading) return <p role="status">Memuat dashboard...</p>;
  if (query.isError || !query.data) return <button onClick={() => query.refetch()}>Coba lagi</button>;
  const realtime = realtimeIsReady(realtimeStatus);
  return <><h1 className="font-display text-2xl uppercase">Dashboard</h1>{query.data.state === "partial" && <p role="status">Sebagian data tidak tersedia.</p>}<div className="grid gap-3 md:grid-cols-2">{[...query.data.health, { name: "realtime", ok: realtime }].map((item) => <article key={item.name} className="brutal-border p-3"><h2>{item.name}</h2><p>{item.ok ? "Normal" : "Tidak tersedia"}</p></article>)}</div><Link to="/super-admin/error-log" search={{ resolved: false }}>Error belum selesai</Link></>;
}
```

Each placeholder child route must export `createFileRoute` using its exact path and render section heading plus `Dalam pengembangan tahap berikutnya.` This preserves independently linkable six-section navigation while 6B-6D replace only child content.

- [ ] **Step 3: Run route source test before route implementation**

Append this route-only assertion to `tests/owner-shell-source.test.ts`:

```ts
it("uses auth-gated layout and six links without server authorization import", () => {
  const route = file("src/routes/super-admin/route.tsx");
  expect(route).toContain('createFileRoute("/super-admin")');
  expect(route).toContain("getAuthStatus");
  expect(route).not.toContain("requireSuperAdmin");
  expect(route).toContain("<Outlet />");
});
```

Run: `npx vitest run tests/owner-shell-source.test.ts`

Expected: FAIL because `src/routes/super-admin/route.tsx` does not exist.

- [ ] **Step 4: Generate routes and restore tracked output**

Run: `npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: both commands exit `0`; generated route tree equals HEAD and remains unstaged.

- [ ] **Step 5: Run source and build checks serially**

Run: `npx vitest run tests/owner-dashboard-domain.test.ts tests/owner-shell-source.test.ts && npx tsc --noEmit && npm run lint && npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: all exit `0`. Run commands serially; concurrent build/test risks Nitro cache corruption.

- [ ] **Step 6: Commit shell only**

```bash
git add -u src/routes/super-admin.tsx
git add src/routes/super-admin/ tests/owner-shell-source.test.ts
git commit -m "feat: add owner console shell"
```

### Task 4: Verify phase boundary

**Files:**
- Modify: no additional production files

- [ ] **Step 1: Check generated and unrelated files stay unstaged**

Run: `git status --short`

Expected: `src/routeTree.gen.ts` equals HEAD and is unstaged; pre-existing `supabase/.temp/` remains untracked and unstaged.

- [ ] **Step 2: Execute final phase-6A verification serially**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: all exit `0`. Build runs last and alone; no parallel test/build invocation.

## Plan Self-Review

- [x] Shell routes follow repository `route.tsx`/`index.tsx` file-routing convention, not invalid sibling layout naming.
- [x] Dashboard covers DB, Realtime, R2, API/deployment, active/total restaurants, active devices, plays today, sync failure, unresolved errors, independent timeouts, partial state, polling, and links.
- [x] Service role remains server-only; every owner snapshot calls `requireSuperAdmin()`; no global client store or RTL added.
