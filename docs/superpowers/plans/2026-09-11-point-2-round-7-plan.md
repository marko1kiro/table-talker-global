# Poin 2 Ronde 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden manager handoff, revocation, and limiter identity contracts, then prove behavior with real HTTP/browser/PostgREST evidence without touching frozen migrations or production.

**Architecture:** Add one forward-only SQL migration after `20260909080000` for immutable reservation binding and authoritative state checks. Keep application orchestration in existing auth/manager modules, with stable logical-attempt IDs owned by clients. Extend existing disposable PostgREST harness and add a production-like HTTP/browser harness using the repository's existing app start/build path.

**Tech Stack:** TypeScript, React/TanStack Start, Vitest, Playwright Chromium, PostgreSQL/PostgREST 16.2, Supabase migrations, Vercel CLI, GitHub Actions.

---

## Task 1: Establish baseline and preflight evidence

**Files:**
- Modify: none
- Test: existing repository suites

- [ ] Confirm `HEAD` is `9dbe9ce246cbdef89121339e0cc0f3556f84d4ba`, branch is `fix/point-2-manager-access-security`, origin is `marko1kiro/table-talker-global`, and worktree is clean.
- [ ] Fetch `origin/main`; record `origin/main`, parent, merge-base, and `git rev-list --left-right --count origin/main...HEAD`.
- [ ] Run read-only Supabase migration history and record whether `09010000` through `09080000` are absent. Do not run apply/push/migration commands.
- [ ] Confirm no open/merged PR for this branch and no production deployment or remote migration action is performed.
- [ ] Run baseline targeted suites and save outputs outside repository.

Run:
```powershell
git status --short --branch
git rev-parse HEAD HEAD^ origin/main
git merge-base HEAD origin/main
git rev-list --left-right --count origin/main...HEAD
npx vitest run tests/point-2-round6-fixes.test.ts tests/db/round6-revoke-verdict.test.ts tests/db/round6-postgrest.test.ts
```

Expected: baseline SHA exact, worktree clean, existing targeted tests pass or known environment skips only. No commit.

## Task 2: R7-A RED — exception-safe manager handoff tests

**Files:**
- Create: `tests/manager-handoff-round7.test.ts`
- Inspect: `src/routes/manager/login.tsx`, `src/lib/manager-auth.server.ts`, `src/lib/auth.server.ts`

- [ ] Add executable tests for `getStorage()` throw, storage write throw, null identity writer, navigation throw, confirm false, confirm throw before commit, cleanup failure, refresh/back/resubmit, and duplicate submission.
- [ ] Make tests assert pending reservation finalization/compensation and absence of active orphan, not source strings.
- [ ] Run `npx vitest run tests/manager-handoff-round7.test.ts`; record intentional RED failure on baseline.
- [ ] Commit only test files:
```powershell
git add tests/manager-handoff-round7.test.ts
git commit -m "test(red): manager handoff exception safety and authoritative recovery"
```

## Task 3: R7-A GREEN — exception-safe handoff implementation

**Files:**
- Modify: `src/routes/manager/login.tsx`
- Modify: `src/lib/manager-auth.server.ts`
- Modify: `src/lib/auth.server.ts` only if existing cleanup contract requires it
- Test: `tests/manager-handoff-round7.test.ts`

- [ ] Wrap storage acquisition, identity writing, confirmation, and navigation in explicit failure paths.
- [ ] Keep token and reservation in one logical-attempt state; bounded retry uses same values.
- [ ] Add authoritative reconcile/compensation before reporting failure; preserve cleanup errors in returned failure state.
- [ ] Run focused tests, then commit:
```powershell
npx vitest run tests/manager-handoff-round7.test.ts

git add src/routes/manager/login.tsx src/lib/manager-auth.server.ts src/lib/auth.server.ts tests/manager-handoff-round7.test.ts
git commit -m "fix(green): make manager handoff exception-safe and authoritative"
```

## Task 4: R7-C RED — immutable reservation binding and concurrency tests

**Files:**
- Create: `supabase/migrations/20260909090000_manager_reservation_binding.sql`
- Create: `tests/db/round7-reservation-binding.test.ts`
- Modify: `tests/db/postgrest-harness.ts` only for required seed/setup helpers

- [ ] Add RED tests for pending mint requiring reservation, null reservation denial, other reservation denial, token/reservation mismatch, same `attempt_key` parallel reserve returning one reservation, expired/dead key, duplicate retry, and bucket accounting.
- [ ] Ensure tests run through actual PostgREST HTTP and parallel requests against disposable PostgreSQL.
- [ ] Run suite against baseline and confirm expected RED failures.
- [ ] Commit tests and migration skeleton only if the migration file is required for test compilation; do not alter frozen SQL/checksum manifest:
```powershell
git add tests/db/round7-reservation-binding.test.ts tests/db/postgrest-harness.ts supabase/migrations/20260909090000_manager_reservation_binding.sql
git commit -m "test(red): bind manager reservations immutably and serialize duplicate attempts"
```

## Task 5: R7-C GREEN — reservation binding and stable attempt identity

**Files:**
- Modify: `supabase/migrations/20260909090000_manager_reservation_binding.sql`
- Modify: `src/lib/owner-login-rate-limit.server.ts`
- Modify: `src/routes/manager/login.tsx`
- Modify: `src/routes/area-manager/login.tsx` if present
- Modify: `src/routes/super-admin/recovery.tsx`
- Modify: invite/accept/recovery/reset flow files identified by existing `attemptKey` search
- Test: `tests/db/round7-reservation-binding.test.ts`, relevant unit tests

- [ ] Make reservation binding `NOT NULL` and immutable after mint; confirm checks stored token/reservation pair.
- [ ] Make same-key reservation retry serialize safely and return the original reservation without exposing `unique_violation`.
- [ ] Remove default-null confirm behavior for manager handoff.
- [ ] Generate one attempt key per logical client attempt and preserve it through transport retry; do not generate a new UUID per server invocation.
- [ ] Add authoritative late reporter/CAS behavior so timed-out reporters cannot contradict compensation/session state.
- [ ] Run actual PostgREST tests and focused unit tests.
- [ ] Commit:
```powershell
git add supabase/migrations/20260909090000_manager_reservation_binding.sql src tests/db/round7-reservation-binding.test.ts
git commit -m "fix(green): bind reservations and preserve attempt identity end to end"
```

## Task 6: R7-B RED — mandatory revocation fail-closed tests

**Files:**
- Create: `tests/round7-revocation-fail-closed.test.ts`
- Modify: `tests/db/round6-revoke-verdict.test.ts` only when adding behavior-level matrix cases

- [ ] Test role switch rejection for `UNKNOWN_TOKEN`, malformed, timeout, RPC error, and `KIND_MISMATCH`.
- [ ] Test acceptance only for `REVOKED` and authoritative `ALREADY_INACTIVE`.
- [ ] Test live/tombstone cross-namespace mismatch and concurrent logout/switch/bulk/reset/deactivation/newest-wins paths through existing service boundaries.
- [ ] Run focused tests and commit RED:
```powershell
npx vitest run tests/round7-revocation-fail-closed.test.ts tests/db/round6-revoke-verdict.test.ts
git add tests/round7-revocation-fail-closed.test.ts tests/db/round6-revoke-verdict.test.ts
git commit -m "test(red): mandatory revocation rejects unknown and mismatched tokens"
```

## Task 7: R7-B GREEN — strict mandatory revocation

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/auth.server.ts`
- Modify: `src/lib/area-manager.server.ts`
- Modify: `src/lib/manager-auth.server.ts`
- Modify: `supabase/migrations/20260909090000_manager_reservation_binding.sql` only for related forward-only SQL if needed
- Test: R7-B suites

- [ ] Remove `tolerateUnknown` from mandatory role-switch call sites and types used by those paths.
- [ ] Keep cleanup/logout tolerance only where token ownership is intentionally best-effort; mandatory switch remains strict.
- [ ] Ensure tombstone/live cross-namespace verdict behavior remains authoritative for all lifecycle paths.
- [ ] Run focused tests, lint, and typecheck; commit:
```powershell
npx vitest run tests/round7-revocation-fail-closed.test.ts tests/db/round6-revoke-verdict.test.ts
npx tsc --noEmit
npx eslint src/lib/auth.ts src/lib/auth.server.ts src/lib/area-manager.server.ts src/lib/manager-auth.server.ts
git add src tests
git commit -m "fix(green): make mandatory role revocation fail closed"
```

## Task 8: R7-D RED — actual HTTP/browser evidence

**Files:**
- Create: `tests/e2e/round7-http-browser.spec.ts`
- Create or modify: `tests/e2e/round7-test-server.ts`
- Modify: `.github/workflows/ci.yml`
- Inspect: existing package scripts and app start/build configuration

- [ ] Start the built application with test-safe environment and production guards enabled.
- [ ] Use Playwright Chromium, not jsdom, for recovery and AM cases.
- [ ] Assert valid/missing/duplicate/malformed/expired/used recovery links, atomic consume, refresh/back/resubmit, provider/config failure, and absence of token in URL/storage/log/analytics/screenshot.
- [ ] Assert stale AM cookie, reset/deactivation, mismatch, expired/malformed token, direct route/action, and no authenticated dashboard for invalid state.
- [ ] Run against baseline and commit RED test-only changes:
```powershell
npx playwright test tests/e2e/round7-http-browser.spec.ts
git add tests/e2e .github/workflows/ci.yml
 git commit -m "test(red): add actual HTTP and browser evidence for recovery and AM auth"
```

## Task 9: R7-D GREEN — production-like HTTP/browser harness

**Files:**
- Modify: `tests/e2e/round7-test-server.ts`
- Modify: `tests/e2e/round7-http-browser.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `package.json` only to add the smallest existing-tool command needed

- [ ] Make server startup deterministic and cleanup processes on success/failure.
- [ ] Use same route guards, cookies, RPC adapters, and redaction behavior as production.
- [ ] Ensure screenshots, traces, logs, and analytics assertions cannot leak raw tokens.
- [ ] Run Playwright locally if dependencies available; otherwise run in CI and record environment limitation honestly.
- [ ] Commit GREEN:
```powershell
npm ci
npx playwright test tests/e2e/round7-http-browser.spec.ts
git add tests/e2e .github/workflows/ci.yml package.json package-lock.json
git commit -m "fix(green): prove recovery and AM auth over real HTTP and Chromium"
```

## Task 10: R7-E PostgREST/concurrency evidence and harness reproducibility

**Files:**
- Modify: `tests/db/round6-postgrest.test.ts`
- Modify: `tests/db/round7-reservation-binding.test.ts`
- Modify: `tests/db/postgrest-harness.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] Add pending/revoked/wrong-kind, payload forgery, cross-tenant, null/other reservation, and parallel same-attempt cases.
- [ ] Add serial and parallel disposable PostgreSQL/PostgREST execution commands using CI versions and non-root wrapper.
- [ ] Keep digest verification, HMAC JWT, full migration chain, fresh directory, stderr capture, and quoted v16 config.
- [ ] Run required suites in Linux sandbox and CI; commit:
```powershell
npx vitest run tests/db/round6-postgrest.test.ts tests/db/round7-reservation-binding.test.ts
git add tests/db .github/workflows/ci.yml
git commit -m "test(green): expand PostgREST binding and concurrency evidence"
```

## Task 11: Final verification and independent review

**Files:**
- Modify: none unless verification finds a defect

- [ ] Run `npm ci`.
- [ ] Run `npm run verify`.
- [ ] Run actual browser suite.
- [ ] Run disposable PostgreSQL integration and required PostgREST suite serial and parallel.
- [ ] Run `git diff --check 9dbe9ce..HEAD` and `git diff --check origin/main..HEAD`.
- [ ] Run repository secret scan and delta scan without exposing secrets.
- [ ] Query exact final SHA GitHub CI status.
- [ ] Query Vercel metadata: deployment ID, full SHA, branch, READY, Preview/non-production, `npm ci`, `npm run build` evidence; do not deploy production.
- [ ] Recheck Supabase migration history read-only; confirm `09010000`–`09080000` remain unapplied and no remote migration was executed.
- [ ] Dispatch `@general` and `@explore` independent review before final report. Fix every blocker/major finding with another RED→GREEN pair.

## Task 12: Push and report

**Files:**
- Modify: none

- [ ] Confirm worktree clean and local HEAD equals remote branch.
- [ ] Push fast-forward only after every gate passes.
- [ ] Stop after push. Do not open PR, merge, deploy production, or apply remote migration.
- [ ] Report full SHA/parent/merge-base/ahead-behind, RED→GREEN commits/files, blocker matrix, command exit codes/counts, Postgres/PostgREST/browser/Realtime truth, GitHub/Vercel exact-SHA metadata, new migration/checksum status, and known gaps.
