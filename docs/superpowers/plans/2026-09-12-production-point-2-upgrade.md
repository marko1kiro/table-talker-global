# Production Point 2 Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely upgrade production from migration `20260908195839` through `20260911160000` without data loss and without application maintenance.

**Architecture:** Deployment runbook creates and verifies encrypted logical backup, confirms remote history, applies every missing migration one at a time with stop-on-failure gates, verifies schema/data contracts, and completes smoke checks while the application stays online.

**Tech Stack:** Supabase CLI 2.117.0, psql/pg_dump/pg_restore, Vercel production, repository documentation.

---

## File structure

- Create: `docs/operations/production-point-2-upgrade-runbook.md` — human-operated backup, migration, verification, and incident procedure; no secrets.
- Create: `docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md` during live window — non-secret timestamps, versions, checksums, counts, and outcomes.

### Task 1: Document production runbook

**Files:**
- Create: `docs/operations/production-point-2-upgrade-runbook.md`

- [ ] **Step 1: Write runbook with exact ordered procedure**

Create runbook containing the ordered commands below. Use environment variables defined only in operator shell; never paste connection strings, backup passphrases, output dumps, or production credentials into repository.

Preflight evidence:

```bash
set -euo pipefail
: "${PROD_DATABASE_URL:?set production Postgres URL in shell}"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select version, name from supabase_migrations.schema_migrations order by version desc limit 5;"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select 'restaurants' as table_name, count(*) from public.restaurants union all select 'restaurant_sessions', count(*) from public.restaurant_sessions union all select 'crew_sessions', count(*) from public.crew_sessions union all select 'crew_role_sessions', count(*) from public.crew_role_sessions union all select 'manager_accounts', count(*) from public.manager_accounts union all select 'manager_sessions', count(*) from public.manager_sessions;"
psql "$PROD_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('crew_sessions','crew_role_sessions','manager_accounts','manager_sessions');"
```

Encrypted backup outside repository:

```bash
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

Restore-check against operator-provided disposable URL:

```bash
: "${RESTORE_CHECK_DATABASE_URL:?set disposable PostgreSQL URL in shell}"
openssl enc -d -aes-256-gcm -pbkdf2 -iter 600000 \
  -in "$BACKUP_DIR/table-talker-$STAMP.dump.enc" \
  -pass file:"$BACKUP_PASSPHRASE_FILE" | pg_restore --clean --if-exists --no-owner \
  --dbname="$RESTORE_CHECK_DATABASE_URL"
psql "$RESTORE_CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select 'restaurants' as table_name, count(*) from public.restaurants union all select 'restaurant_sessions', count(*) from public.restaurant_sessions union all select 'crew_sessions', count(*) from public.crew_sessions union all select 'crew_role_sessions', count(*) from public.crew_role_sessions union all select 'manager_accounts', count(*) from public.manager_accounts union all select 'manager_sessions', count(*) from public.manager_sessions;"
```

Sequential migration application. First verify pending list without mutation:

```bash
npx --yes supabase@2.117.0 migration list --db-url "$PROD_DATABASE_URL"
npx --yes supabase@2.117.0 db push --db-url "$PROD_DATABASE_URL" --dry-run
```

Then for each exact version in this order: `20260909010000`, `20260909020000`, `20260909030000`, `20260909040000`, `20260909050000`, `20260909060000`, `20260909070000`, `20260909080000`, `20260909090000`, `20260909100000`, `20260909110000`, `20260909120000`, `20260909130000`, `20260909140000`, `20260911120000`, `20260911130000`, `20260911140000`, `20260911150000`, `20260911160000`:

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

Before each run use `npx --yes supabase@2.117.0 migration list --db-url "$PROD_DATABASE_URL"` and confirm only the expected next version is pending. Never execute migration SQL directly or insert migration-history rows manually.

Postflight checks:

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

Application smoke checks after migration success, using existing approved test identities only: restaurant login, crew role claim/heartbeat, Manager login/handoff, AM login, SA login. Never create/delete production restaurants, accounts, audio, QR, or R2 data for smoke checks. Then inspect Supabase/Postgres and application logs for rollout window.

- [ ] **Step 2: State stop conditions**

Stop migration work and retain diagnostic mode for: backup/checksum/restore-check failure; remote migration drift; any migration failure; unexpected row loss; failed RLS, grants, or function-security check; failed auth/crew smoke; or elevated error logs. Application traffic continues; do not restore automatically.

- [ ] **Step 3: Commit runbook**

```bash
git add docs/operations/production-point-2-upgrade-runbook.md
git commit -m "docs: add Point 2 production upgrade runbook"
```

### Task 2: Execute production backup, preflight, and sequential migration window

**Files:**
- Create: `docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md`

- [ ] **Step 1: Capture immutable preflight evidence**

Run runbook preflight commands. Expected last migration: `20260908195839`; expected RLS enabled on listed tables. Stop if different.

- [ ] **Step 2: Create encrypted backup and restore-check**

Execute runbook backup and restore-check commands. Compare restore-check counts with preflight counts. Record only SHA-256 digest, dump timestamp, restore exit status, and counts. Stop on mismatch or any nonzero exit.

- [ ] **Step 3: Apply each missing migration in lexical order**

Execute the runbook sequential migration procedure for every listed version. Before each run confirm only expected next version is pending. Record applied version and exit status. Stop at first failure; do not issue rollback commands without separate approval.

- [ ] **Step 4: Postflight integrity and security checks**

Run runbook postflight commands. Verify migration history through `20260911160000`, Point 2 tables/functions exist, RLS/function security attributes match contracts. Repeat protected table counts from preflight. Explain only migration-defined expected changes; otherwise stop.

- [ ] **Step 5: Run non-destructive application smoke checks**

Use existing approved test identities to verify restaurant login, crew role claim/heartbeat, Manager login/handoff, AM login, and SA login against production. Then check application and Supabase logs for the rollout window. Stop migration follow-up if errors appear.

- [ ] **Step 6: Record evidence and close window**

Create evidence document with backup checksum, all applied versions, pre/post counts, RLS/function check results summarized without secrets, smoke pass/fail, log review time, start/finish timestamps. Commit this evidence only after sanitizing all secrets.

- [ ] **Step 7: Run full quality gate and commit evidence**

Run: `npm run verify`

Expected: exit 0.

```bash
git add docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md
git commit -m "docs: record Point 2 production upgrade evidence"
```

## Stop conditions

Do not proceed beyond any failed backup, checksum, restore-check, migration, protected-count, RLS/function, smoke, or log gate. Keep further migration execution stopped while diagnosing. Never store connection strings, raw dumps, passphrases, tokens, raw logs, or user data in git.
