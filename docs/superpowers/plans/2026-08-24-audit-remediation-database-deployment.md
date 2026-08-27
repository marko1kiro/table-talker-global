# Audit Remediation Database And Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix retention deployment, normalize `pgcrypto`, restore stale crew cleanup, align Realtime topic, and make retention Edge execution observable.

**Architecture:** Correct the blocking verifier in place because later migrations cannot run after it fails, then add one forward corrective migration for final schema changes. Support explicit `pg_cron` and `edge_required` modes without claiming Edge readiness before a successful invocation.

**Tech Stack:** Supabase PostgreSQL, PL/pgSQL, pg_cron, Supabase Edge Functions/Deno, Vitest.

---

## File Structure

- Modify: `supabase/migrations/20260824006000_owner_retention_verification.sql` - accept exact cron or explicit Edge-required mode.
- Create: `supabase/migrations/20260824007000_audit_database_remediation.sql` - scheduler state, pgcrypto normalization, final crew claim, Realtime topic, credential retention.
- Modify: `supabase/functions/owner-retention/index.ts` - thin bootstrap with deadline.
- Create: `supabase/functions/owner-retention/handler.ts` - testable request handler.
- Create: `tests/audit-database-remediation.test.ts` - final SQL contract tests.
- Modify: `tests/owner-retention-source.test.ts` - dual-mode and handler contract.
- Create: `tests/owner-retention-handler.test.ts` - executable Edge behavior tests.
- Modify: `README.md` and `docs/supabase-super-admin-remote-audio.md` - dual-mode runbook.

### Task 1: Define dual scheduler contract red

**Files:**
- Create: `tests/audit-database-remediation.test.ts`
- Modify: `tests/owner-retention-source.test.ts`

- [ ] **Step 1: Write failing scheduler tests**

Add assertions that final SQL creates `owner_retention_scheduler_state`, permits only `pg_cron|edge_required`, revokes browser roles, verifies exact cron command when mode is cron, and does not require `cron.job` for `edge_required`.

```ts
it("supports explicit cron and edge-required retention modes", () => {
  const repair = file("supabase/migrations/20260824007000_audit_database_remediation.sql");
  expect(repair).toContain("owner_retention_scheduler_state");
  expect(repair).toMatch(/mode text not null check \(mode in \('pg_cron', 'edge_required'\)\)/i);
  expect(repair).toMatch(/revoke all on public\.owner_retention_scheduler_state from public, anon, authenticated/i);
  expect(repair).toContain("select public.cleanup_owner_retention()");
  expect(repair).toContain("edge_required");
});
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/audit-database-remediation.test.ts tests/owner-retention-source.test.ts`

Expected: FAIL because corrective migration and dual-mode contract do not exist.

- [ ] **Step 3: Correct blocking verifier in place**

Modify `20260824006000_owner_retention_verification.sql` so absent `cron` no longer fails migration. Keep cleanup function correction intact. Verification must fail only when cron schema exists but an existing `owner-retention-daily` job has wrong schedule or command.

```sql
do $$
begin
  if to_regclass('cron.job') is not null and exists (
    select 1 from cron.job
    where jobname = 'owner-retention-daily'
      and (schedule <> '17 3 * * *' or command <> 'select public.cleanup_owner_retention()')
  ) then
    raise exception 'OWNER_RETENTION_SCHEDULER_INVALID';
  end if;
end;
$$;
```

- [ ] **Step 4: Add scheduler state in forward migration**

Create `20260824007000_audit_database_remediation.sql`. Create one-row state table keyed by scheduler name, RLS/revokes, then attempt exact cron schedule. Catch only known extension/permission capability errors and set `edge_required`; rethrow every other error.

```sql
create table public.owner_retention_scheduler_state (
  scheduler_name text primary key check (scheduler_name = 'owner-retention-daily'),
  mode text not null check (mode in ('pg_cron', 'edge_required')),
  schedule text not null check (schedule = '17 3 * * *'),
  last_success_at timestamptz,
  last_result jsonb,
  updated_at timestamptz not null default now()
);
alter table public.owner_retention_scheduler_state enable row level security;
revoke all on public.owner_retention_scheduler_state from public, anon, authenticated;
```

Use an exception flag in the same `DO` block. If cron succeeds, upsert `pg_cron` and assert exact row. Otherwise upsert `edge_required` with null success fields. Never swallow unexpected errors.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/audit-database-remediation.test.ts tests/owner-retention-source.test.ts`

Expected: scheduler tests PASS.

- [ ] **Step 6: Checkpoint scheduler contract**

Run: `git diff --check -- supabase/migrations/20260824006000_owner_retention_verification.sql supabase/migrations/20260824007000_audit_database_remediation.sql tests/audit-database-remediation.test.ts tests/owner-retention-source.test.ts`

Expected: no whitespace errors. Do not stage or commit without explicit user request.

### Task 2: Normalize pgcrypto and final database contracts

**Files:**
- Modify: `supabase/migrations/20260824007000_audit_database_remediation.sql`
- Modify: `tests/audit-database-remediation.test.ts`

- [ ] **Step 1: Write failing final-state tests**

Assert migration creates `extensions`, relocates `pgcrypto` when namespace differs, verifies required procedures, replaces final `claim_crew_session` with tenant stale cleanup, emits `owner-dashboard`, and grants no new browser access.

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/audit-database-remediation.test.ts`

Expected: FAIL on missing pgcrypto/claim/Realtime contracts.

- [ ] **Step 3: Add pgcrypto preflight**

At migration start, create `extensions`, inspect `pg_extension`, install or relocate extension, then assert functions.

```sql
create schema if not exists extensions;
do $$
declare current_schema text;
begin
  select n.nspname into current_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pgcrypto';
  if current_schema is null then
    create extension pgcrypto with schema extensions;
  elsif current_schema <> 'extensions' then
    alter extension pgcrypto set schema extensions;
  end if;
  if to_regprocedure('extensions.digest(bytea,text)') is null
    or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'PGCRYPTO_NAMESPACE_INVALID';
  end if;
end;
$$;
```

- [ ] **Step 4: Replace final crew claim**

Copy final signature/body from `20260824000000_fix_crew_token_generation.sql`, preserving every token/version validation. Insert before upsert:

```sql
update public.crew_sessions
set connection_state = 'disconnected', offline_at = now(), updated_at = now()
where restaurant_id = p_restaurant_id
  and connection_state in ('connecting', 'connected')
  and last_seen <= now() - interval '30 seconds';
```

Reapply exact revokes/grant: execute only to `authenticated`, not `anon`, `public`, or `service_role`.

- [ ] **Step 5: Align Realtime topic**

Replace trigger function body so `realtime.send(..., 'invalidate', 'owner-dashboard', false)` matches UI consumer. Keep `SECURITY DEFINER`, explicit search path, and revokes.

- [ ] **Step 6: Integrate credential audit retention**

Replace `cleanup_owner_retention()` using final event columns and add:

```sql
delete from public.restaurant_credential_audit
where created_at < now() - interval '90 days';
get diagnostics credential_audit_deleted = row_count;
```

Return `credential_audit_deleted` in JSON. Keep execute restricted to `service_role`.

- [ ] **Step 7: Run focused database tests**

Run: `npx vitest run tests/audit-database-remediation.test.ts tests/tenant-rpc-fixes.test.ts tests/remote-audio-migration.test.ts tests/owner-retention-source.test.ts`

Expected: PASS.

- [ ] **Step 8: Checkpoint database corrections**

Run: `git diff --check -- supabase/migrations/20260824007000_audit_database_remediation.sql tests/audit-database-remediation.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 3: Make Edge retention executable and observable

**Files:**
- Create: `supabase/functions/owner-retention/handler.ts`
- Modify: `supabase/functions/owner-retention/index.ts`
- Create: `tests/owner-retention-handler.test.ts`

- [ ] **Step 1: Write failing handler tests**

Test exported `handleOwnerRetention(request, deps)` for `405`, `401`, missing config, RPC error, timeout, and success. Dependency contract:

```ts
type Dependencies = {
  url?: string;
  serviceRoleKey?: string;
  cleanup: (signal: AbortSignal) => Promise<{ data: unknown; error: { message: string } | null }>;
  recordSuccess: (data: unknown, signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
};
```

- [ ] **Step 2: Run red handler test**

Run: `npx vitest run tests/owner-retention-handler.test.ts`

Expected: FAIL because handler module does not exist.

- [ ] **Step 3: Implement minimal handler**

Validate method and exact bearer using constant-time-safe fixed hash comparison where runtime supports Web Crypto. Create `AbortController`, abort after `timeoutMs ?? 8_000`, invoke cleanup, then record scheduler success only after cleanup succeeds. Return `cache-control: no-store`; map abort to `504`, other RPC failure to `500`. Clear timer in `finally`.

- [ ] **Step 4: Keep bootstrap thin**

`index.ts` reads env, creates Supabase client with session persistence disabled, passes RPC functions into handler, and calls `Deno.serve`. `recordSuccess` updates only row `owner-retention-daily` with `last_success_at`, count summary, and `updated_at`.

- [ ] **Step 5: Run handler and retention tests**

Run: `npx vitest run tests/owner-retention-handler.test.ts tests/owner-retention-source.test.ts`

Expected: PASS with timeout and auth branches exercised.

- [ ] **Step 6: Checkpoint Edge behavior**

Run: `git diff --check -- supabase/functions/owner-retention tests/owner-retention-handler.test.ts tests/owner-retention-source.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 4: Update dual-mode operations docs

**Files:**
- Modify: `README.md`
- Modify: `docs/supabase-super-admin-remote-audio.md`
- Modify: `tests/owner-retention-source.test.ts`

- [ ] **Step 1: Add failing runbook assertions**

Require docs to contain `owner-retention`, `edge_required`, `17 3 * * *`, `SUPABASE_SERVICE_ROLE_KEY`, `last_success_at`, and exactly-one-scheduler warning.

- [ ] **Step 2: Run red docs test**

Run: `npx vitest run tests/owner-retention-source.test.ts`

Expected: FAIL on missing public runbook details.

- [ ] **Step 3: Write operator runbook**

Document read-only mode query, exact cron verification, Edge deploy/schedule command prerequisites, bearer requirement, one successful heartbeat requirement, and no claim of health while `last_success_at is null`. Never include real project ref or secret.

- [ ] **Step 4: Run focused suite**

Run: `npx vitest run tests/audit-database-remediation.test.ts tests/owner-retention-handler.test.ts tests/owner-retention-source.test.ts`

Expected: PASS.

- [ ] **Step 5: Checkpoint docs**

Run: `git diff --check -- README.md docs/supabase-super-admin-remote-audio.md tests/owner-retention-source.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 5: Database plan verification checkpoint

- [ ] **Step 1: Run all database/security source tests**

Run: `npx vitest run tests/audit-database-remediation.test.ts tests/owner-retention-handler.test.ts tests/owner-retention-source.test.ts tests/tenant-rpc-fixes.test.ts tests/remote-audio-migration.test.ts tests/server-authorization.test.ts`

Expected: PASS.

- [ ] **Step 2: Run disposable DB verification when available**

Run: `npx supabase db reset --local`

Expected: PASS only against confirmed disposable local Supabase. If local config/runtime is absent, do not connect remote; record exact gate as UNVERIFIED.

- [ ] **Step 3: Inspect grants and scheduler state read-only**

Run SQL on disposable DB only: verify extension namespace, function grants, exact cron or `edge_required`, stale claim behavior, and retention cutoffs. Do not invoke cleanup against non-disposable data.

- [ ] **Step 4: Record checkpoint without hiding unavailable gates**

Update `audit-output/checkpoint.md` only if audit artifacts remain part of deliverable. Mark runtime migration PASS or UNVERIFIED with exact reason.
