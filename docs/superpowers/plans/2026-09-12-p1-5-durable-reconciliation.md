# P1-5 Durable Manager Handoff Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve exact manager handoff verdicts after cascade and retention deletes.

**Architecture:** Forward migration adds service-private exact evidence keyed by bearer hash and reservation. Existing lifecycle RPCs write terminal evidence under current locks. Reconciliation reads exact evidence after canonical locks, with missing evidence failing closed as `UNKNOWN`.

**Tech Stack:** PostgreSQL, Supabase migrations, security-definer RPCs, Vitest, embedded PostgreSQL.

---

### Task 1: RED durable-evidence DB tests

**Files:**
- Modify: `tests/db/manager-pending-tombstone-lifecycle.test.ts`
- Modify: `tests/db/manager-lifecycle-cutover-overlap.test.ts`

- [ ] **Step 1: Add exact evidence helper and tests**

Add a helper that queries `manager_handoff_reconciliation_registry` by SHA-256 token hash and reservation ID. Test mint as `PENDING`, confirm as `SUCCEEDED`, then active revoke, pending cleanup, manager cascade, restaurant cascade, and reservation/tombstone retention as exact `FAILED`. Test same bearer hash with another reservation returns `UNKNOWN`.

```ts
expect(await reconcile(c, token, reservationId)).toBe("FAILED");
expect(await reconcile(c, token, otherReservationId)).toBe("UNKNOWN");
expect(await registry(c, token, reservationId)).toMatchObject({ state: "FAILED" });
```

- [ ] **Step 2: Run RED test command**

Run: `npx vitest run tests/db/manager-pending-tombstone-lifecycle.test.ts tests/db/manager-lifecycle-cutover-overlap.test.ts`

Expected: fail because registry does not exist and cascaded pairs reconcile as `UNKNOWN`.

### Task 2: Forward registry and canonical lifecycle writers

**Files:**
- Create: `supabase/migrations/20260911160000_manager_handoff_reconciliation_registry.sql`
- Modify: `tests/db/manager-pending-tombstone-lifecycle.test.ts`

- [ ] **Step 1: Create registry migration**

Create `public.manager_handoff_reconciliation_registry` with no raw bearer:

```sql
create table public.manager_handoff_reconciliation_registry (
  token_hash text not null,
  reservation_id uuid not null,
  manager_id uuid not null,
  state text not null check (state in ('PENDING', 'SUCCEEDED', 'FAILED')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (token_hash, reservation_id)
);
alter table public.manager_handoff_reconciliation_registry enable row level security;
revoke all on public.manager_handoff_reconciliation_registry from public, anon, authenticated;
```

Add private helper `record_manager_handoff_reconciliation(...)` as security definer with `set search_path = pg_catalog, public`. It accepts only `PENDING`, `SUCCEEDED`, `FAILED`; terminal state cannot regress.

- [ ] **Step 2: Forward-replace lifecycle RPCs**

In existing canonical lock order, have `create_manager_session_pending` write `PENDING`, `confirm_manager_session` write `SUCCEEDED` after activation and rate-limit success, and every terminal delete write `FAILED` before deletion. Cover cleanup, expiry, overlap termination, reservation cascade, manager cascade, restaurant cascade, and retention. Preserve bearer derivation, rate-limit contract, browser code, and old migration files.

- [ ] **Step 3: Run GREEN focused DB tests**

Run Task 1 command. Expected: pass with full migration chain replay.

### Task 3: Registry-authoritative reconciliation and security tests

**Files:**
- Modify: `supabase/migrations/20260911160000_manager_handoff_reconciliation_registry.sql`
- Modify: `tests/db/manager-pending-tombstone-lifecycle.test.ts`
- Modify: `tests/db/manager-lifecycle-cutover-overlap.test.ts`

- [ ] **Step 1: Add failing reconciliation/security tests**

Assert exact registry terminal verdict wins after source rows, reservation, and tombstone are gone. Assert RLS enabled, `anon`/`authenticated`/`public` table access absent, helper has no execute grant, exposed RPC stays service-only, `search_path` fixed, and registry never stores raw bearer.

- [ ] **Step 2: Replace reconciliation RPC**

After validation and canonical locks, read exact registry row. Return registry `SUCCEEDED` or `FAILED`; return `PENDING` only if registry is `PENDING` and matching live pending/reservation remain unexpired and unconsumed; otherwise return `FAILED`. Missing or inconsistent row returns `UNKNOWN`.

- [ ] **Step 3: Run focused DB suites**

Run Task 1 command. Expected: pass.

### Task 4: Ablation, full verification, and controlled migration

**Files:**
- Modify only files from Tasks 1-3.

- [ ] **Step 1: Ablate evidence write and evidence read**

Temporarily remove registry terminal writes, run cascade/retention focused tests and confirm failure. Restore. Temporarily remove registry read from reconciliation, rerun exact terminal tests and confirm failure. Restore exact code and rerun focused suites.

- [ ] **Step 2: Audit**

Run `git diff --check`, inspect migration diff, and scan changed SQL/tests for raw bearer output. Verify all new security-definer functions use fixed `search_path`, grants/revokes are least privilege, table RLS is enabled, and no crew login function or grant changes.

- [ ] **Step 3: Run exact local gate**

Run: `npm run verify`

Expected: exit 0.

- [ ] **Step 4: Commit and push**

Commit only P1-5 code/tests/migration. Push fast-forward to `fix/point-2-blockers-r12`; fetch and verify remote SHA matches local.

- [ ] **Step 5: Supabase migration decision**

Before applying, inspect affected migration SQL and production schema/migration state. Apply only the new forward migration if exact local tests, audit, and crew-login compatibility checks pass. Do not merge main, deploy Vercel, or apply any prior unapproved migration.

- [ ] **Step 6: Confirm CI and stop**

Wait for GitHub `CI` `verify` success on pushed SHA. Stop after reporting migration result, CI result, and residual risk.
