# Phase 6E Rollout And Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install automatic 30-day playback/error retention and verify Phase 6 deploy/build/runtime acceptance paths.

**Architecture:** Build after 6A-6D. Cleanup is database-scheduled, never browser-visit driven; one idempotent service-role RPC deletes playback events, operational errors, and broadcast parent rows older than 30 days using `created_at`. Deployment uses current Vercel Nitro build path, serial test/type/lint/build commands, and source contract checks proving server imports bundle without exposing service-role values. This plan changes no unrelated audit findings.

**Tech Stack:** Supabase PostgreSQL/pg_cron or scheduled Edge Function, TanStack Start/Nitro Vercel build, Vitest, TypeScript, ESLint.

---

## Dependency Order

1. Requires completed 6A, 6B, 6C, and 6D.
2. Use migration `20260824005000_owner_retention.sql`, after 6D `20260824004000`.
3. Apply migrations in lexical order through `npx supabase db push --include-all`; after every build restore tracked `src/routeTree.gen.ts` with `git restore --source=HEAD -- src/routeTree.gen.ts`, never stage it.

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260824005000_owner_retention.sql` | Automatic cleanup RPC and pg_cron job when extension exists. |
| `supabase/functions/owner-retention/index.ts` | Scheduled Function fallback when pg_cron unavailable. |
| `tests/owner-retention-source.test.ts` | Cleanup and server-build source contract. |
| `tests/phase-6-route-source.test.ts` | All six routes and owner-only boundary contract. |

### Task 1: Define automatic retention and final route contract red

**Files:**
- Create: `tests/owner-retention-source.test.ts`
- Create: `tests/phase-6-route-source.test.ts`

- [ ] **Step 1: Write failing retention source test**

```ts
import { existsSync, readFileSync } from "node:fs"; import { expect, it } from "vitest";
const root = new URL("../", import.meta.url); const file = (p: string) => readFileSync(new URL(p, root), "utf8");
it("provides non-browser 30-day playback and error cleanup", () => {
  const migration = file("supabase/migrations/20260824005000_owner_retention.sql");
  expect(migration).toContain("cleanup_owner_retention");
  expect(migration).toContain("interval '30 days'");
  expect(migration).toContain("playback_events");
  expect(migration).toContain("operational_errors");
  expect(migration).toContain("owner_broadcasts");
  expect(existsSync(new URL("supabase/functions/owner-retention/index.ts", root))).toBe(true);
});
```

- [ ] **Step 2: Write failing final route test**

```ts
import { readFileSync } from "node:fs"; import { expect, it } from "vitest";
const file = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
it("ships all owner sections without old remote grid", () => {
  for (const path of ["index.tsx", "restaurants/index.tsx", "audio.tsx", "history.tsx", "error-log.tsx", "broadcast.tsx"]) expect(file(`src/routes/super-admin/${path}`)).toContain("createFileRoute");
  expect(file("src/routes/super-admin/route.tsx")).toContain("getAuthStatus");
  expect(file("src/routes/super-admin/route.tsx")).not.toContain("requireSuperAdmin");
  expect(file("src/routes/super-admin/route.tsx")).not.toContain("SoundboardGrid");
});
```

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/owner-retention-source.test.ts tests/phase-6-route-source.test.ts`

Expected: FAIL missing retention migration/function.

### Task 2: Add automatic cleanup with scheduler fallback

**Files:**
- Create: `supabase/migrations/20260824005000_owner_retention.sql`
- Create: `supabase/functions/owner-retention/index.ts`

- [ ] **Step 1: Add idempotent cleanup migration**

```sql
create or replace function public.cleanup_owner_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare playback_deleted integer; errors_deleted integer; broadcasts_deleted integer;
begin
  delete from public.playback_events where created_at < now() - interval '30 days'; get diagnostics playback_deleted = row_count;
  delete from public.operational_errors where created_at < now() - interval '30 days'; get diagnostics errors_deleted = row_count;
  delete from public.owner_broadcasts where created_at < now() - interval '30 days'; get diagnostics broadcasts_deleted = row_count;
  return jsonb_build_object('playback_deleted', playback_deleted, 'errors_deleted', errors_deleted, 'broadcasts_deleted', broadcasts_deleted);
end;
$$;
revoke all on function public.cleanup_owner_retention() from public, anon, authenticated;
grant execute on function public.cleanup_owner_retention() to service_role;
```

If project enables `pg_cron`, schedule exactly once after migration apply:

```sql
create extension if not exists pg_cron;
select cron.schedule('owner-retention-daily', '17 3 * * *', $$select public.cleanup_owner_retention()$$)
where not exists (select 1 from cron.job where jobname = 'owner-retention-daily');
```

- [ ] **Step 2: Add scheduled Function fallback**

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
Deno.serve(async () => {
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await client.rpc("cleanup_owner_retention");
  return error ? new Response("cleanup failed", { status: 500 }) : Response.json(data);
});
```

Configure exactly one scheduler: use pg_cron when available; otherwise Supabase Scheduled Function `owner-retention` at `17 3 * * *`. Neither route is invoked from browser/UI.

- [ ] **Step 3: Run focused tests**

Run: `npx vitest run tests/owner-retention-source.test.ts tests/phase-6-route-source.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit retention**

```bash
git add supabase/migrations/20260824005000_owner_retention.sql supabase/functions/owner-retention/index.ts tests/owner-retention-source.test.ts tests/phase-6-route-source.test.ts
git commit -m "feat: schedule owner data retention"
```

### Task 3: Apply migrations and execute acceptance verification

**Files:**
- Modify: no production files unless failed verification identifies Phase 6 requirement omission

- [ ] **Step 1: Apply migrations in order**

Run: `npx supabase db push --include-all`

Expected: exit `0`; migrations through `20260824005000_owner_retention.sql` apply in lexical order. If local project link/config is absent, stop before deployment and record exact CLI error; do not substitute browser cleanup.

- [ ] **Step 2: Verify database function and scheduler read-only**

Run in Supabase SQL editor:

```sql
select proname from pg_proc where proname in ('owner_dashboard_aggregates','owner_restaurant_rows','cleanup_owner_retention') order by proname;
select jobname, schedule, command from cron.job where jobname = 'owner-retention-daily';
```

Expected: first query returns all three names; second returns one scheduled job only when pg_cron path was selected. Do not execute `cleanup_owner_retention()` against non-disposable data. It deletes rows irreversibly. After explicit user confirmation only, insert seeded disposable rows older than 30 days in isolated test tenant, invoke function once, and verify only seeded rows delete. Create two restaurants and prove every owner list/detail/history/error/broadcast server query with restaurant ID only returns that tenant records; cross-tenant direct client reads remain denied by RLS.

- [ ] **Step 3: Run serial automated verification**

Run: `npm test && npx tsc --noEmit && npm run lint && npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: every command exits `0`. Do not run test/build in parallel: Nitro cache is shared. Build must complete with Vercel preset and no server-only secret appears in client source/bundle inspection.

- [ ] **Step 4: Run browser acceptance matrix**

1. Desktop and narrow mobile: navigate Dashboard, Resto, Audio, Riwayat, Error Log, Broadcast through sidebar/drawer.
2. Disable each DB/Realtime/R2/API dependency independently: Dashboard retains unrelated cards, labels partial state, and loaded mutation controls remain usable when server reachable.
3. Create/view/rotate/deactivate restaurant; detail shows identity, crew, catalog, recent activity; destructive confirmation rejects nonexact name.
4. Manage table, announcement, custom MP3 audio; force PUT/verification failure and confirm prior catalog remains; confirm each successful mutation increments catalog version.
5. History opens at seven days; 31-day range rejects; resolved error accepts blank or note and remains filterable.
6. Single broadcast targets active eligible sessions only. All-active preview count appears; `BROADCAST SEMUA ` with trailing space fails; exact phrase succeeds. Force one restaurant failure and confirm successful tenant deliveries remain plus per-restaurant failures show.
7. Verify scheduler configuration read-only. Run retention deletion only against seeded disposable rows after explicit user confirmation; browser visits never trigger it.

- [ ] **Step 5: Check staging boundary and commit verification artifacts only if changed**

Run: `git status --short`

Expected: `src/routeTree.gen.ts` equals HEAD and is unstaged; `supabase/.temp/` remains unstaged; no unrelated audit changes. Do not commit verification output.

## Plan Self-Review

- [x] Supplies automatic 30-day cleanup by `created_at` for playback, operational errors, and broadcast parent rows, independent of browser visits, with concrete pg_cron and Scheduled Function paths.
- [x] Covers final desktop/mobile, health partial states, tenant isolation, audio failure preservation, error notes, exact all confirmation, partial broadcast, serial full verification, and Vercel Nitro build.
- [x] Uses migration versions after `20260824000000`, excludes route tree and unrelated audit remediation.
