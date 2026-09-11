# Local Remote-Baseline Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate Point 2 migration chain and crew-login compatibility without Supabase branching or production mutation.

**Architecture:** Disposable embedded PostgreSQL replays repository migrations from empty schema. Existing DB contract tests verify P1-5 lifecycle security and crew authentication contracts. Production Supabase remains read-only inventory only.

**Tech Stack:** Vitest, embedded PostgreSQL, repository SQL migrations, Supabase read-only MCP.

---

### Task 1: Read-only production baseline inventory

**Files:**
- Create: `docs/handoffs/2026-09-12-remote-baseline-local-replay.md`

- [ ] **Step 1: Record production migration boundary**

Use `supabase_list_migrations` and `supabase_list_tables` only. Record last applied migration, missing Point 2 sequence `20260909010000` through `20260911160000`, existing manager/crew table presence, RLS status, and explicit statement that no production mutation occurred.

- [ ] **Step 2: Verify no write API is called**

Do not call `supabase_apply_migration`, deploy Edge Functions, Vercel, merge, or branch APIs.

### Task 2: Disposable full-chain replay and P1-5 gate

**Files:**
- Test: `tests/db/manager-pending-tombstone-lifecycle.test.ts`
- Test: `tests/db/manager-lifecycle-cutover-overlap.test.ts`

- [ ] **Step 1: Run Point 2 replay suites**

Run:

```bash
npx vitest run tests/db/manager-pending-tombstone-lifecycle.test.ts tests/db/manager-lifecycle-cutover-overlap.test.ts
```

Expected: all tests pass; each suite creates disposable PostgreSQL and replays complete migration chain.

- [ ] **Step 2: Check lifecycle security contract**

Confirm test assertions cover RLS enabled for registry, service-only exposed RPCs, private helper execute revoked, fixed `search_path`, and raw bearer absence.

### Task 3: Crew login compatibility smoke

**Files:**
- Test: `tests/db/staff-access.integration.test.ts`
- Test: `tests/restaurant-login-build.test.ts`

- [ ] **Step 1: Run crew authentication contract suite**

Run targeted crew/session tests available in repository, including current `claim_crew_session` signature, authenticated execute grants, RLS, and tenant/session token path.

```bash
npx vitest run tests/db/staff-access.integration.test.ts -t "crew|realtime|claim_crew_session"
```

Expected: pass with no production database access.

- [ ] **Step 2: Run build-contract coverage**

Run:

```bash
npx vitest run tests/restaurant-login-build.test.ts
```

Expected: pass under Node 22.20.

### Task 4: Full evidence and stop

**Files:**
- Modify: `docs/handoffs/2026-09-12-remote-baseline-local-replay.md`

- [ ] **Step 1: Run exact quality gate**

Run:

```bash
npm run verify
```

Expected: exit 0.

- [ ] **Step 2: Publish local evidence only**

Document commands, result counts, migration boundary, crew-contract result, and residual risk: repository replay does not prove production-data upgrade compatibility.

- [ ] **Step 3: Commit documentation only if evidence changes repository state**

Commit handoff evidence in a separate docs commit. Do not apply remote migration, merge, deploy, or force-push.
