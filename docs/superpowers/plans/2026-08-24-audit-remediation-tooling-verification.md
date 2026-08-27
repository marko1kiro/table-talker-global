# Audit Remediation Tooling And Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add truthful validation commands, remove lint debt at root cause, and prove all remediation without suppressed failures.

**Architecture:** Use installed TypeScript/ESLint/Vitest/Vite tooling. Keep Edge validation explicit, run final gates serially, and preserve generated/user files.

**Tech Stack:** TypeScript, ESLint, Prettier, Vitest, Vite/Nitro, Git.

---

## File Structure

- Modify: `package.json` - `typecheck`, `check:edge`, `verify` scripts.
- Modify: lint-reported source/test files only - formatting, exact types, hook lifecycle.
- Modify: `tests/owner-retention-handler.test.ts` if Edge import boundary needs Node-safe adapter.
- Modify: `audit-output/checkpoint.md`, `audit-output/findings.md`, `audit-output/full-audit-report.md`, `audit-output/command-results.md` - closure evidence, only after checks.

### Task 1: Add truthful scripts

- [ ] **Step 1: Create script contract test**

Create `tests/config-scripts.test.ts`. Read and parse `package.json`, then assert exact script values.

Create or extend config test to require:

```json
{
  "typecheck": "tsc --noEmit",
  "check:edge": "deno check supabase/functions/owner-retention/index.ts",
  "verify": "npm test && npm run typecheck && npm run check:edge && npm run lint && npm run build"
}
```

Do not add fallback `|| true`, conditional skip, or output masking.

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/config-scripts.test.ts`

Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Add scripts to `package.json`**

Use exact commands above. Do not modify lockfile because no dependency is added.

- [ ] **Step 4: Run script contract and typecheck**

Run: `npx vitest run tests/config-scripts.test.ts && npm run typecheck`

Expected: contract PASS. Typecheck may expose real defects; keep failures visible for Task 2.

- [ ] **Step 5: Checkpoint scripts**

Run: `git diff --check -- package.json tests/config-scripts.test.ts`

Expected: no whitespace errors. Do not stage or commit.

### Task 2: Fix type and hook defects

- [ ] **Step 1: Capture fresh failures**

Run separately: `npm run typecheck` and `npm run lint`.

Expected: record exact current errors. Do not run `--fix` yet.

- [ ] **Step 2: Fix explicit `any` errors**

Replace `any` in `src/lib/restaurant-audit.server.ts` and `src/lib/restaurant-session.server.ts` with minimal structural Supabase client/result types or existing `SupabaseClient` type. Do not broaden to `unknown as any`.

- [ ] **Step 3: Fix hook lifecycle warnings**

- `SyncDialog.tsx`: capture `const gate = runGateRef.current` inside effect cleanup and make `runSync` dependency stable/correct without disabling rule.
- `use-remote-crew.ts`: ensure effect depends on exact registration values used, using existing `registrationKey` only if every consumed field is represented.
- `src/routes/index.tsx`: include stable `recordEvent` dependency in playback callback; if identity-sensitive, use existing ref pattern without stale closure.

- [ ] **Step 4: Run focused tests and checks**

Run: `npx vitest run tests/sync-dialog.test.ts tests/use-remote-crew.test.ts tests/playback-events.test.ts && npm run typecheck && npm run lint`

Expected: behavioral tests PASS; remaining lint failures are formatting/known non-hook issues only.

- [ ] **Step 5: Checkpoint behavioral lint fixes**

Run: `git diff --check -- src/components/SyncDialog.tsx src/hooks/use-remote-crew.ts src/routes/index.tsx src/lib/restaurant-audit.server.ts src/lib/restaurant-session.server.ts tests`

Expected: no whitespace errors. Do not stage or commit.

### Task 3: Clear formatting lint debt without semantic changes

- [ ] **Step 1: Run formatter only on lint-reported files**

From fresh lint output, pass every reported non-generated path explicitly to Prettier. Initial baseline list is:

Run: `npx prettier --write scripts/provision-restaurant-code.mjs src/components/AuthGate.tsx src/lib/audio-sync.ts src/lib/crew-message-domain.ts src/lib/crew-session-identity.ts src/lib/event-flush.ts src/lib/playback-access.server.ts src/lib/restaurant-session.server.ts tests/audio-sync.test.ts tests/error-capture.test.ts tests/event-flush.test.ts tests/event-queue.test.ts tests/r2-server.test.ts tests/restaurant-code-migration.test.ts tests/restaurant-code-provisioning.test.ts tests/restaurant-code-server.test.ts tests/restaurant-sessions.test.ts tests/restaurants-server.test.ts tests/restaurants.test.ts tests/server-authorization.test.ts tests/soundboard-sync-wiring.test.ts tests/sync-dialog.test.ts tests/tenant-rpc-fixes.test.ts tests/tenant-session.test.ts`

If fresh lint reports additional formatting paths introduced by remediation, append those exact paths. Never run `prettier --write .`.

Do not format generated files, migration history, audit reports, or unrelated clean files.

- [ ] **Step 2: Fix non-format regex diagnostics manually**

Replace literal repeated spaces in test regexes with `{4}` or exact whitespace tokens. Preserve assertion strength.

- [ ] **Step 3: Inspect diff**

Run: `git diff --stat` and `git diff --check`.

Expected: only intended source/test formatting and prior semantic fixes; no migration semantic changes from formatter.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: PASS with 0 errors and 0 warnings. If not, fix each root cause; do not suppress.

- [ ] **Step 5: Run full tests after formatting**

Run: `npm test`

Expected: PASS, no reduced test count.

- [ ] **Step 6: Checkpoint formatting debt**

Run: `git diff --check` after inspecting every formatted file.

Expected: no whitespace errors and no unintended semantic diff. Do not stage or commit.

### Task 4: Validate Edge tooling honestly

- [ ] **Step 1: Run Edge check**

Run: `npm run check:edge`

Expected: PASS when Deno and import cache/network policy permit. If executable is absent or remote import unavailable, command must fail; record exact prerequisite instead of changing script to skip.

- [ ] **Step 2: Run executable handler tests regardless of Deno availability**

Run: `npx vitest run tests/owner-retention-handler.test.ts`

Expected: PASS because handler dependencies are injected and no network is used.

- [ ] **Step 3: Inspect Edge source for secrets**

Search built/source output for actual environment values is prohibited. Statically verify only env variable names occur and responses/logs do not include `serviceRoleKey`, authorization header, or RPC error detail.

### Task 5: Run final serial gates

- [ ] **Step 1: Record pre-gate Git state**

Run: `git status --short --branch`.

Expected: only intended remediation/spec/plan/audit artifacts plus pre-existing `supabase/.temp/`.

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: PASS with all prior 306 tests plus new tests; no skipped files.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`

Expected: PASS independently.

- [ ] **Step 4: Run Edge check**

Run: `npm run check:edge`

Expected: PASS or explicitly recorded BLOCKED prerequisite. BLOCKED is not PASS and prevents full `verify` claim.

- [ ] **Step 5: Run lint**

Run: `npm run lint`

Expected: PASS with zero errors/warnings.

- [ ] **Step 6: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Restore generated route tree only**

Run: `git restore --source=HEAD -- src/routeTree.gen.ts` only if build changed it and no intentional route change requires regeneration. Then run `git diff --check` and `git status --short`.

Expected: no accidental generated/vendor changes.

### Task 6: Audit closure and anti-greenwashing review

- [ ] **Step 1: Search forbidden masking patterns**

Search remediation diff for `eslint-disable`, `@ts-ignore`, `.skip`, `it.skip`, `describe.skip`, `.only`, `passWithNoTests`, `|| true`, empty new catches, and weakened assertions.

Expected: none introduced. Existing `passWithNoTests` in `vitest.config.ts` must be removed now that 61+ test files exist; update config test accordingly.

- [ ] **Step 2: Review each finding against evidence**

Map H-01, M-01..M-05, L-01..L-05, NV-01 to code, focused regression test, and gate output. Do not mark fixed from source inspection alone when runtime check is required.

- [ ] **Step 3: Update audit reports**

For each finding add remediation status: `Fixed`, `Partially verified`, or `Blocked`, commit/SHA if available, test command, and residual risk. Preserve original finding text. Update command results with fresh exact counts.

- [ ] **Step 4: Request independent review**

Dispatch read-only reviewer against complete diff. Fix any confirmed Critical/High regression, then rerun affected focused and full gates.

- [ ] **Step 5: Final branch verification**

Run: `git status`, `git diff --check`, `git diff --stat`, and inspect intended diff. Do not commit/push unless user explicitly requests it.
