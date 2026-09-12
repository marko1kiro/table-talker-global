# Production Point 2 Upgrade Design

## Scope

Upgrade production from remote migration `20260908195839` through repository migration `20260911160000`. Preserve every database record. Supabase Storage and Cloudflare R2 are out of scope. Keep all login paths unavailable during rollout. If a gate fails, keep maintenance active for diagnosis; do not restore automatically.

## Preconditions

- Branch `fix/point-2-blockers-r12` is pushed at `cd67de8` or descendant.
- Operator has Supabase CLI access to production and a local encrypted backup location outside repository.
- Operator has a disposable PostgreSQL instance for restore verification.
- No concurrent schema changes, deploys, migration repair, or manual production writes occur during window.

## Backup and rollback boundary

Before maintenance, create PostgreSQL logical dumps for schema plus data. Encrypt dumps outside repository, record SHA-256 checksums, then restore them into disposable PostgreSQL and verify restore exit status and expected table counts. This protects current production assets without exporting R2 objects.

Rollback is manual and only after diagnosis: restore verified backup to production under a separately approved recovery procedure. Migration failures do not trigger automatic rollback because DDL and data mutations need incident review. Login remains blocked until either forward fix or approved restore passes smoke checks.

## Login maintenance gate

Add a shared server guard controlled only by `MAINTENANCE_MODE=login_lock`. Every restaurant, crew, staff, Manager, Area Manager, and Super Admin login mutation calls it before validation, credential lookup, RPC, token mint, or session write. When enabled, guard returns HTTP 503 and no database mutation occurs. It does not block authenticated non-login routes, R2, or Storage.

Deploy tested gate before production database work. Enable `MAINTENANCE_MODE=login_lock` in production and verify rejected login submissions before backup. Disable it only after every postflight and smoke gate passes. If any gate fails, keep it enabled for diagnosis.

## Rollout

1. Deploy application maintenance gate, enable `MAINTENANCE_MODE=login_lock`, and verify every login mutation rejects before credentials/session mutation.
2. Re-read production migration inventory and confirm last version remains `20260908195839`.
3. Capture preflight evidence: migration versions, row counts for active identity/session tables, RLS enabled state, and required function/grant presence.
4. Apply repository migrations individually and in lexical version order from `20260909010000_staff_identity_schema.sql` through `20260911160000_manager_handoff_reconciliation_registry.sql`. Stop at first nonzero result. Record version, command output, and post-version schema check after each group.
5. Run postflight SQL checks: migration history equals intended chain; Point 2 tables/functions exist; RLS and function security attributes match migration contracts; active crew/role/manager sessions retain referential integrity.
6. Run application smoke checks against production: rejected login while maintenance active; then, after disabling maintenance, restaurant, crew, Manager, AM, and SA login; session heartbeat/claim; RLS-scoped reads; manager handoff reconciliation path. Use non-destructive existing test identities only.
7. Inspect Supabase/Postgres and application logs. Reopen all login paths only after every gate passes.

## Gates

Stop and retain maintenance for: backup/checksum/restore-check failure; remote migration drift; any migration failure; unexpected row loss; failed RLS, grants, or function-security check; failed auth/crew smoke; or elevated error logs.

Success requires verified backup, exact migration history through `20260911160000`, stable protected row counts or explained expected changes, successful smoke checks, clean error logs, and a written evidence record.

## Security

Backups and CLI output may contain credentials or personal data. Keep dump, encryption key, database URL, and raw logs outside git. Evidence committed to repository contains only versions, counts, checksum identifiers, timestamps, and pass/fail status.
