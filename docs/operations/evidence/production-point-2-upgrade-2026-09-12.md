# Production Point 2 Upgrade — Evidence (2026-09-12)

Runbook: `docs/operations/production-point-2-upgrade-runbook.md`.
Project: `kjzxtmxdbcanvkgqqdow` (Supabase). App: `https://qris-order.lihatmeja.com`.

## Preflight (read-only)

- Remote last migration before window: `20260908195839_drop_super_admin_purge_restaurant_test_data`.
- Pending chain: 19 files `20260909010000`–`20260911160000`.
- Data inventory: restaurants=9, restaurant_sessions=28, crew_role_sessions=66→67 (live),
  manager_sessions=3, manager_accounts=1, RLS enabled on 32 public tables.
- Connectivity: direct `db.<ref>.supabase.co:5432` is IPv6-only and the operator network is
  IPv4-only → used Session Pooler `aws-0-ap-southeast-1.pooler.supabase.com:5432`
  (user `postgres.kjzxtmxdbcanvkgqqdow`). `pg_isready` + `select version()` = PostgreSQL 17.6.

## Backup + restore-check

- `pg_dump --format=custom --no-owner --no-privileges` (client 17.5) at 08:54 local:
  `backup/point2-pre-upgrade-20260912.dump`, 1,084,191 bytes.
- SHA-256: `d0f09915b4478bdfd6f9b67e1b95678360764a717aa5eb3334fd5ae1e727b01b`.
- Encrypted AES-256-GCM (PBKDF2-SHA256, 600k iter, passphrase file outside repo):
  `backup/point2-pre-upgrade-20260912.dump.enc`. Plaintext dump deleted after encryption.
- Decrypt roundtrip checksum = identical to original. Verified.
- Restore-check into disposable local PostgreSQL 17.5 (`localhost:5499/restore_check`,
  `--no-owner --no-privileges`): 32/32 tables restored. Row-count compare: all equal except
  `crew_role_sessions`, `restaurant_access_tokens`, `role_session_tokens` (+1 in prod).
  Key-set diff proved the extra rows exist only in prod (created after the dump) and
  `missingInProd=0` for every table → backup contains 100% of snapshot data.
  Extension-related restore errors (`pg_cron` etc.) expected on vanilla PG; not data.

## Apply

- One-off note: the first migration was initially applied through the Supabase MCP
  (`apply_migration`), which records apply-time versions. Its history row was reconciled
  to the canonical `20260909010000` / `staff_identity_schema`.
- Migrations 2–19 applied via `psql --single-transaction -v ON_ERROR_STOP=1 -f <file>`
  through the Session Pooler, then recorded with
  `supabase@2.117.0 migration repair --status applied <version>` (canonical versions/names).
- Loop log: all 18 `DONE_OK`, zero failures. Each migration is one transaction.
- Known pre-existing drift: remote history rows `20260831130720`…`20260907172552` carry
  apply-time versions that do not match local filenames. Full reconciliation is a separate
  task; it does not affect this window (no re-apply occurred — Point 2 files were pending
  by version).

## Postflight

- `supabase_migrations.schema_migrations` contains all 19 Point 2 versions through `20260911160000`.
- New tables live with RLS enabled: `staff_id_registry`, `super_admin_accounts`,
  `area_manager_accounts`, `area_manager_assignments`, `staff_sessions`,
  `manager_reset_requests`, `am_reset_requests`, `super_admin_recovery_tokens`,
  `admin_audit_log`, `manager_pending_sessions`. `system_settings` is service-role-only by
  revoke (no RLS by design).
- Backfill: `staff_id_registry` = 1 row (the single legacy manager account).
  `system_settings.super_admin_bootstrap` = `{"open": true}`.
- `manager_sessions` = 0: by design (R6-D fail-closed cutover in `20260909060000`);
  managers re-login after the app deploy.
- Master data intact: restaurants=9, manager_accounts=1, crew_role_sessions=67 (live).

## App deploy + smoke

- PR #22 (`fix/point-2-blockers-r12` → `main`) merged as `f95cd5b`; Vercel CI green.
  Production now runs Point 2 code (required: `register_manager` is dropped by migration;
  old UI would 500 on manager self-registration).
- HTTP smoke: `/`, `/manager`, `/kasir` → 200 on `https://qris-order.lihatmeja.com`.
- Manual smoke pending from operator: crew login (code+PIN), manager login (must create a
  fresh session), manager dashboard reads, occupancy realtime.

## Rollback posture

- No automatic rollback occurred or was needed. If a rollback is ever required: decrypt the
  `.enc` backup with the passphrase file, restore into a fresh database, validate, then
  swap — decision gate is manual by design (spec: hold for diagnosis first).
