# Production Point 2 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tested global login maintenance gate, then safely upgrade production from migration `20260908195839` through `20260911160000` without data loss.

**Architecture:** Shared server guard runs at each login mutation boundary before validation or database access and returns an explicit maintenance result. Deployment runbook creates and verifies encrypted logical backup, freezes logins, applies every missing migration in version order, checks schema/data contracts, and reopens logins only after smoke gates pass.

**Tech Stack:** TypeScript, TanStack Start server functions, Vitest, Supabase CLI/PostgreSQL tools, Vercel environment configuration.

---

## File structure

- Create: `src/lib/login-maintenance.server.ts` — process-env gate and typed maintenance error.
- Modify: `src/lib/restaurants.server.ts` — protect restaurant-code and PIN login mutations.
- Modify: `src/lib/staff-login.server.ts` — protect staff login and manager-handoff confirmation mutations.
- Modify: `src/lib/auth.ts` — protect Super Admin login.
- Modify: `.env.example` — document server-only `MAINTENANCE_MODE` value.
- Create: `tests/login-maintenance.test.ts` — direct guard behavior and static coverage of all login boundaries.
- Create: `docs/operations/production-point-2-upgrade-runbook.md` — human-operated backup, migration, verification, and incident procedure; no secrets.
- Create: `docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md` during live window — non-secret timestamp, versions, checksums, counts, and outcomes.

### Task 1: Define login maintenance guard

**Files:**
- Create: `src/lib/login-maintenance.server.ts`
- Test: `tests/login-maintenance.test.ts`

- [ ] **Step 1: Write failing direct guard tests**

```ts
import { afterEach, describe, expect, it } from "vitest";
import { LoginMaintenanceError, requireLoginAvailable } from "@/lib/login-maintenance.server";

const original = process.env.MAINTENANCE_MODE;
afterEach(() => {
  if (original === undefined) delete process.env.MAINTENANCE_MODE;
  else process.env.MAINTENANCE_MODE = original;
});

describe("login maintenance", () => {
  it("allows login when login_lock is absent", () => {
    delete process.env.MAINTENANCE_MODE;
    expect(() => requireLoginAvailable()).not.toThrow();
  });

  it("rejects login_lock before any login dependency is used", () => {
    process.env.MAINTENANCE_MODE = "login_lock";
    expect(() => requireLoginAvailable()).toThrow(LoginMaintenanceError);
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npx vitest run tests/login-maintenance.test.ts`

Expected: FAIL; module `@/lib/login-maintenance.server` does not exist.

- [ ] **Step 3: Add minimal guard**

```ts
export class LoginMaintenanceError extends Error {
  status = 503;
  code = "LOGIN_MAINTENANCE";

  constructor() {
    super("LOGIN_MAINTENANCE");
  }
}

export function requireLoginAvailable(): void {
  if (process.env.MAINTENANCE_MODE === "login_lock") throw new LoginMaintenanceError();
}
```

- [ ] **Step 4: Run guard test**

Run: `npx vitest run tests/login-maintenance.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/login-maintenance.server.ts tests/login-maintenance.test.ts
git commit -m "feat(auth): add login maintenance guard"
```

### Task 2: Guard every login mutation before DB/session work

**Files:**
- Modify: `src/lib/restaurants.server.ts:30-59,81-105`
- Modify: `src/lib/staff-login.server.ts:421-451,525-607`
- Modify: `src/lib/auth.ts:296-366`
- Modify: `tests/login-maintenance.test.ts`

- [ ] **Step 1: Extend failing coverage test for exact login boundaries**

```ts
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("checks maintenance before every login-side client or session dependency", () => {
  expect(source("src/lib/restaurants.server.ts")).toMatch(
    /handler\(async \(\{ data \}\) => \{\s*requireLoginAvailable\(\);\s*const client = getServiceClient\(\)/,
  );
  expect(source("src/lib/staff-login.server.ts")).toMatch(
    /handler\(async \(\{ data \}\): Promise<LoginStaffResult> => \{\s*requireLoginAvailable\(\);\s*const client = getServiceClient\(\)/,
  );
  expect(source("src/lib/auth.ts")).toMatch(
    /handler\(async \(\{ data \}\): Promise<\{ ok: boolean; message\?: string \}> => \{\s*requireLoginAvailable\(\);/,
  );
});
```

Include equivalent assertion for `confirmManagerHandoff` before `getServiceClient()`.

- [ ] **Step 2: Run test and verify failure**

Run: `npx vitest run tests/login-maintenance.test.ts`

Expected: FAIL; login functions do not yet invoke `requireLoginAvailable()`.

- [ ] **Step 3: Add guard imports and first-statement calls**

In each listed server module import `requireLoginAvailable` from `./login-maintenance.server`. Make it first statement in handlers for:

```ts
loginToRestaurant
verifyRestaurantPin
loginStaff
confirmManagerHandoff
loginSuperAdmin
```

Do not guard logout, authenticated reads, role-session heartbeats, R2, or Storage operations. Do not catch `LoginMaintenanceError`; framework must surface HTTP 503 before any client/RPC/session call.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run tests/login-maintenance.test.ts tests/role-login-flow.test.ts tests/point-2-manager-login-route.test.tsx tests/restaurant-login-build.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full quality gate**

Run: `npm run verify`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/restaurants.server.ts src/lib/staff-login.server.ts src/lib/auth.ts tests/login-maintenance.test.ts
git commit -m "feat(auth): block login mutations during maintenance"
```

### Task 3: Document production runbook and env contract

**Files:**
- Modify: `.env.example:17-19`
- Create: `docs/operations/production-point-2-upgrade-runbook.md`
- Test: `tests/login-maintenance.test.ts`

- [ ] **Step 1: Write failing source-contract test**

```ts
it("documents server-only login maintenance mode", () => {
  const env = source(".env.example");
  expect(env).toContain("MAINTENANCE_MODE=");
  expect(env).toContain("login_lock");
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npx vitest run tests/login-maintenance.test.ts`

Expected: FAIL; environment example lacks maintenance contract.

- [ ] **Step 3: Document safe operator procedure**

Add to `.env.example`:

```dotenv
# Server-only emergency login gate. Set exactly login_lock during approved DB maintenance.
# Deploy after changing this value; remove or leave empty only after every rollout gate passes.
MAINTENANCE_MODE=
```

Create runbook containing exact ordered commands below. Use environment variables defined only in operator shell; never paste connection strings, backup passphrases, output dumps, or production credentials into repository.

```bash
set -euo pipefail
: "${PROD_DATABASE_URL:?set production Postgres URL in shell}"
: "${BACKUP_DIR:?set encrypted backup directory outside repository}"
: "${BACKUP_PASSPHRASE_FILE:?set passphrase file outside repository}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
pg_dump --format=custom --no-owner --no-privileges --dbname="$PROD_DATABASE_URL" \
  --file="$BACKUP_DIR/table-talker-$STAMP.dump"
openssl enc -aes-256-gcm -salt -pbkdf2 -iter 600000 \
  -in "$BACKUP_DIR/table-talker-$STAMP.dump" \
  -out "$BACKUP_DIR/table-talker-$STAMP.dump.enc" \
  -pass file:"$BACKUP_PASSPHRASE_FILE"
sha256sum "$BACKUP_DIR/table-talker-$STAMP.dump.enc" \
  > "$BACKUP_DIR/table-talker-$STAMP.dump.enc.sha256"
rm "$BACKUP_DIR/table-talker-$STAMP.dump"
```

Document restore-check against operator-provided disposable URL:

```bash
: "${RESTORE_CHECK_DATABASE_URL:?set disposable PostgreSQL URL in shell}"
openssl enc -d -aes-256-gcm -pbkdf2 -iter 600000 \
  -in "$BACKUP_DIR/table-talker-$STAMP.dump.enc" \
  -pass file:"$BACKUP_PASSPHRASE_FILE" | pg_restore --clean --if-exists --no-owner \
  --dbname="$RESTORE_CHECK_DATABASE_URL"
psql "$RESTORE_CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select 'restaurants' as table_name, count(*) from public.restaurants union all select 'manager_sessions', count(*) from public.manager_sessions union all select 'crew_role_sessions', count(*) from public.crew_role_sessions;"
```

Document Vercel sequence: deploy gate code, set `MAINTENANCE_MODE=login_lock` for Production, redeploy, and make one invalid-input request per login route expecting HTTP 503. Do not execute DB migration unless backup checksum and restore-check both pass.

- [ ] **Step 4: Run source-contract test**

Run: `npx vitest run tests/login-maintenance.test.ts`

Expected: PASS.

- [ ] **Step 5: Run full quality gate**

Run: `npm run verify`

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add .env.example docs/operations/production-point-2-upgrade-runbook.md tests/login-maintenance.test.ts
git commit -m "docs: add Point 2 production upgrade runbook"
```

### Task 4: Execute production backup, preflight, and sequential migration window

**Files:**
- Create: `docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md`

- [ ] **Step 1: Freeze deploys and enable maintenance**

Deploy commits from Tasks 1–3. Set production `MAINTENANCE_MODE=login_lock`, redeploy, then verify HTTP 503 for restaurant (`loginToRestaurant`), crew PIN (`verifyRestaurantPin`), staff (`loginStaff`), Manager confirmation (`confirmManagerHandoff`), and Super Admin (`loginSuperAdmin`) server functions. Record deployment SHA and timestamp in evidence. Stop if any login path returns non-503 or writes a session.

- [ ] **Step 2: Capture immutable preflight evidence**

Run through authenticated operator shell:

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select version, name from supabase_migrations.schema_migrations order by version desc limit 5;"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select 'restaurants' as table_name, count(*) from public.restaurants union all select 'restaurant_sessions', count(*) from public.restaurant_sessions union all select 'crew_sessions', count(*) from public.crew_sessions union all select 'crew_role_sessions', count(*) from public.crew_role_sessions union all select 'manager_accounts', count(*) from public.manager_accounts union all select 'manager_sessions', count(*) from public.manager_sessions;"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('crew_sessions','crew_role_sessions','manager_accounts','manager_sessions');"
```

Expected last migration: `20260908195839`. Stop if different.

- [ ] **Step 3: Create encrypted backup and restore-check**

Execute Task 3 backup and restore-check commands. Compare restore-check counts with preflight counts. Record only SHA-256 digest, dump timestamp, restore exit status, and counts in evidence. Stop on mismatch or any nonzero exit.

- [ ] **Step 4: Preview and apply each missing migration in lexical order**

First verify the exact pending sequence without mutation:

```bash
npx --yes supabase@2.117.0 migration list --db-url "$PROD_DATABASE_URL"
npx --yes supabase@2.117.0 db push --db-url "$PROD_DATABASE_URL" --dry-run
```

Expected remote last version: `20260908195839`; expected pending first/last versions: `20260909010000` / `20260911160000`. Stop on any history drift.

Supabase CLI owns `supabase_migrations.schema_migrations`; never execute migration SQL directly and never insert migration-history rows manually. To apply exactly one next migration, construct a disposable CLI directory containing repository migrations through that version only. CLI then sees precisely one pending migration, applies its statements in its own transaction, and records its version only after success.

```bash
VERSION=20260909010000
WORKDIR="$(mktemp -d)"
mkdir -p "$WORKDIR/supabase/migrations"
cp supabase/config.toml "$WORKDIR/supabase/config.toml"
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort | \
  awk -v version="$VERSION" -F/ '{ name=$NF; split(name, parts, "_"); if (parts[1] <= version) print }' | \
  xargs -I{} cp {} "$WORKDIR/supabase/migrations/"
(
  cd "$WORKDIR"
  npx --yes supabase@2.117.0 migration up --db-url "$PROD_DATABASE_URL"
)
rm -rf "$WORKDIR"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select version, name from supabase_migrations.schema_migrations where version='$VERSION';"
```

Run this exact sequence once for this ordered list, replacing only `VERSION`: `20260909010000`, `20260909020000`, `20260909030000`, `20260909040000`, `20260909050000`, `20260909060000`, `20260909070000`, `20260909080000`, `20260909090000`, `20260909100000`, `20260909110000`, `20260909120000`, `20260909130000`, `20260909140000`, `20260911120000`, `20260911130000`, `20260911140000`, `20260911150000`, `20260911160000`. Before each run, use `npx --yes supabase@2.117.0 migration list --db-url "$PROD_DATABASE_URL"` and confirm only expected next version is pending. Record applied version and exit status. Stop and retain maintenance at first failure; do not issue rollback commands without separate approval.

- [ ] **Step 5: Postflight integrity and security checks**

Run:

```bash
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select version from supabase_migrations.schema_migrations where version between '20260909010000' and '20260911160000' order by version;"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select to_regclass('public.staff_id_registry'), to_regclass('public.manager_pending_sessions'), to_regclass('public.manager_handoff_reconciliation_registry');"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('staff_id_registry','super_admin_accounts','area_manager_accounts','manager_pending_sessions','manager_handoff_reconciliation_registry');"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('record_manager_handoff_reconciliation','reconcile_manager_session_handoff');"
```

Repeat protected table counts from preflight. Explain only migration-defined expected changes; otherwise stop.

- [ ] **Step 6: Restore login and run non-destructive smoke checks**

Remove production `MAINTENANCE_MODE` value, redeploy, then use existing approved test identities to verify restaurant login, crew role claim/heartbeat, Manager login/handoff, Area Manager login, and Super Admin login. Never create/delete production restaurants, accounts, audio, QR, or R2 data for smoke checks. Check application and Supabase logs for rollout window; stop and re-enable maintenance if errors appear.

- [ ] **Step 7: Record evidence and close window**

Create evidence document with branch SHA, deployment SHA, backup checksum, all applied versions, pre/post counts, RLS/function check output summarized without secrets, smoke pass/fail, log review time, and maintenance enable/disable times. Commit this evidence only after sanitizing all secrets.

- [ ] **Step 8: Run full quality gate and commit evidence**

Run: `npm run verify`

Expected: exit 0.

```bash
git add docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md
git commit -m "docs: record Point 2 production upgrade evidence"
```

## Stop conditions

Do not proceed beyond any failed backup, checksum, restore-check, migration, protected-count, RLS/function, smoke, or log gate. Keep `MAINTENANCE_MODE=login_lock` enabled while diagnosing. Never store connection strings, raw dumps, passphrases, tokens, raw logs, or user data in git.
