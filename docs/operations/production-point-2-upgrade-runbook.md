# Production Point 2 Upgrade Runbook

Human-operated procedure. Upgrade production from migration `20260908195839` through `20260911160000`. Application stays online. Never paste connection strings, backup passphrases, output dumps, or production credentials into this repository. Evidence contains only versions, checksums, counts, timestamps, and pass/fail status.

## Preconditions

- Operator shell defines: `PROD_DATABASE_URL`, `BACKUP_DIR` (outside repository), `BACKUP_PASSPHRASE_FILE` (outside repository), `RESTORE_CHECK_DATABASE_URL` (disposable PostgreSQL).
- `psql`, `pg_dump`, `pg_restore`, `openssl`, `sha256sum`, and Node 22 are available.
- No concurrent deploys, schema changes, or manual production writes during the window.

## 1. Preflight evidence

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

Expected last migration: `20260908195839`. Expected RLS enabled for all listed tables. Stop if different.

## 2. Encrypted backup outside repository

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

## 3. Restore-check into disposable PostgreSQL

```bash
: "${RESTORE_CHECK_DATABASE_URL:?set disposable PostgreSQL URL in shell}"
openssl enc -d -aes-256-gcm -pbkdf2 -iter 600000 \
  -in "$BACKUP_DIR/table-talker-$STAMP.dump.enc" \
  -pass file:"$BACKUP_PASSPHRASE_FILE" | pg_restore --clean --if-exists --no-owner \
  --dbname="$RESTORE_CHECK_DATABASE_URL"
psql "$RESTORE_CHECK_DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "select 'restaurants' as table_name, count(*) from public.restaurants union all select 'restaurant_sessions', count(*) from public.restaurant_sessions union all select 'crew_sessions', count(*) from public.crew_sessions union all select 'crew_role_sessions', count(*) from public.crew_role_sessions union all select 'manager_accounts', count(*) from public.manager_accounts union all select 'manager_sessions', count(*) from public.manager_sessions;"
```

Compare counts with preflight. Stop on mismatch or any nonzero exit.

## 4. Verify pending migration list

```bash
npx --yes supabase@2.117.0 migration list --db-url "$PROD_DATABASE_URL"
npx --yes supabase@2.117.0 db push --db-url "$PROD_DATABASE_URL" --dry-run
```

Expected remote last version: `20260908195839`. Expected pending first/last versions: `20260909010000` / `20260911160000`. Supabase CLI owns `supabase_migrations.schema_migrations`; never execute migration SQL directly and never insert migration-history rows manually.

## 5. Apply each migration, one at a time

For each exact version in this order: `20260909010000`, `20260909020000`, `20260909030000`, `20260909040000`, `20260909050000`, `20260909060000`, `20260909070000`, `20260909080000`, `20260909090000`, `20260909100000`, `20260909110000`, `20260909120000`, `20260909130000`, `20260909140000`, `20260911120000`, `20260911130000`, `20260911140000`, `20260911150000`, `20260911160000`.

Before each run confirm only the expected next version is pending:

```bash
npx --yes supabase@2.117.0 migration list --db-url "$PROD_DATABASE_URL"
```

Then apply exactly one version from a disposable CLI directory that contains repository migrations through that version. CLI applies the file inside its own transaction and records its version only after success:

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

Run this sequence once per version, replacing only `VERSION`. Record each applied version and exit status. Stop at first failure; never issue rollback commands without separate approval.

## 6. Postflight integrity and security checks

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

Repeat the protected table counts from step 1. Explain only migration-defined expected changes; otherwise stop.

## 7. Application smoke checks

Use existing approved test identities only. Never create/delete production restaurants, accounts, audio, QR, or R2 data for smoke checks.

1. Restaurant login and crew role claim/heartbeat.
2. Manager login and handoff confirmation path.
3. Area Manager login.
4. Super Admin login.
5. RLS-scoped reads for each role.

Then inspect Supabase/Postgres and application logs for the rollout window.

## 8. Stop conditions

Stop migration work and retain diagnostic mode for: backup/checksum/restore-check failure; remote migration drift; any migration failure; unexpected row loss; failed RLS, grants, or function-security check; failed auth/crew smoke; or elevated error logs. Application traffic continues; do not restore automatically.

## 9. Evidence record

Create `docs/operations/evidence/production-point-2-upgrade-YYYY-MM-DD.md` containing: backup checksum, all applied versions, pre/post counts, RLS/function check results summarized without secrets, smoke pass/fail, log review time, and start/finish timestamps. Commit only after sanitizing all secrets.
