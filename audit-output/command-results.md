# Hasil Command Audit

Timestamp akhir checks: `2026-08-24T13:39:00+07:00`

## Baseline Git

```text
branch: main
SHA: caba78e8569cfd987f30ca050eb196154f6b92a5
target: main / caba78e (cocok)
initial untracked: supabase/.temp/
final untracked: audit-output/, supabase/.temp/
```

Tidak ada source/config/dependency/lockfile yang diubah. `npm run build` meregenerasi tracked `src/routeTree.gen.ts`; perubahan generated tersebut dipulihkan ke `HEAD` setelah output build dicatat.

## `npm test`

- Status: PASS
- Test files: 61 passed / 61
- Tests: 306 passed / 306
- Durasi: 11.43 detik

## `npm run build`

- Status: PASS
- Client, SSR, dan Nitro Vercel output berhasil dibuat.
- Warning: `node:crypto` di-externalize untuk browser karena import dari `src/lib/restaurant-session.server.ts`.
- Warning: `vite-tsconfig-paths` terdeteksi walau Vite memiliki dukungan native baru.
- Tidak ada build error.
- Artefak generated `.vercel/` diabaikan Git; tracked route tree dipulihkan setelah check.

## `npm run lint`

- Status: FAIL
- Total: 83 masalah, terdiri dari 73 error dan 10 warning.
- ESLint melaporkan 70 error dapat diperbaiki otomatis, tetapi audit tidak menjalankan `--fix`.
- Dominan: Prettier formatting.
- Non-format penting: `@typescript-eslint/no-explicit-any`, `no-regex-spaces`, dan hook dependency/cleanup warnings.
- Finding terkait: L-05.

## Typecheck dan External Checks

- Tidak ada script `typecheck` resmi pada `package.json`.
- `npm run build` memproses TypeScript/Vite dengan sukses, tetapi bukan bukti penuh `tsc --noEmit` terpisah.
- Supabase migration tidak diterapkan ke DB disposable.
- Edge Function tidak diperiksa dengan Deno/Supabase CLI.
- Dependency advisory scan tidak dijalankan karena memerlukan network/fresh advisory data.

## DB Remediation Verification

Timestamp: `2026-08-25T01:16:22+07:00`

### Focused Aggregate

Command:

```text
npx vitest run tests/audit-database-remediation.test.ts tests/owner-retention-handler.test.ts tests/tenant-rpc-fixes.test.ts tests/remote-audio-migration.test.ts tests/server-authorization.test.ts tests/auth-telemetry-hardening.test.ts
```

Output:

```text
Test Files  6 passed (6)
Tests  58 passed (58)
Duration  956ms
```

### Owner Retention Source

Command:

```text
npx vitest run tests/owner-retention-source.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  6 passed (6)
Duration  473ms
```

### Typecheck and Diff

```text
npx tsc --noEmit
exit: 0
output: (none)

git diff --check
exit: 0
output: warnings only: LF will be replaced by CRLF for pre-existing modified files
```

### Local Supabase Preconditions

```text
supabase/config.toml: absent
docker: NOT_INSTALLED
local Supabase CLI: 2.115.0
```

Status: **UNVERIFIED exact**. `supabase db reset --local` not run. No config, local Docker, disposable-local proof. No linked project connection; `supabase/.temp/` ignored.

## AD6 Verification

Timestamp: `2026-08-26`

### Focused Aggregate Serial

Command:

```text
npx vitest run --maxWorkers=1 --no-file-parallelism tests/auth-super-admin.test.ts tests/auth-rate-limit-remediation.test.ts tests/restaurants-server.test.ts tests/restaurant-code-server.test.ts tests/use-remote-crew.test.ts tests/owner-broadcast-domain.test.ts tests/owner-broadcast-idempotency.test.ts tests/owner-query-cache.test.ts tests/owner-shell-source.test.ts tests/super-admin-route.test.ts
```

Output:

```text
Test Files  10 passed (10)
Tests  96 passed (96)
Duration  5.49s
```

`tests/owner-broadcast-ui.test.ts` tidak ada; tidak dapat dimasukkan tanpa membuat test baru.

### Full Serial Test and Typecheck

```text
npm test -- --maxWorkers=1 --no-file-parallelism
Test Files  69 passed (69)
Tests  384 passed (384)
Duration  27.94s

npx tsc --noEmit
exit: 0
output: (none)
```

### Targeted ESLint

Command mencakup 30 changed AD source/test file.

```text
Status: FAIL
1 error, 1 warning
tests/owner-retention-source.test.ts:101:27  prettier/prettier
src/hooks/use-remote-crew.ts:734:6  react-hooks/exhaustive-deps (missing registration)
```

### Build and Diff

```text
npm run build
exit: 0
client, SSR, Nitro Vercel: built
warnings: vite-tsconfig-paths deprecation guidance; node:crypto browser externalization from src/lib/restaurant-session.server.ts

git diff --check
exit: 0
output: LF-to-CRLF warnings only for pre-existing modified files
```

### Cumulative Diff Scan

```text
tracked diff: 22 files, 1373 insertions, 256 deletions
untracked AD source/test/migration: 30 files
added grants to anon/authenticated: none, except final authenticated-only claim_crew_session grant after revoking public/anon/service_role
password/token logs: none
new empty catches: none
new skips/suppressions: none
old removed tenant rate-limit RPC consumers: none
generated src/routeTree.gen.ts secrets: none
```

### Runtime and Remote

```text
SQL runtime: UNVERIFIED exact
supabase/config.toml: absent
Docker: unavailable
remote/network commands: none
git remote configured: origin (not contacted)
```

AD6 status: **BLOCKED** by targeted ESLint error. No source edits made.

## TV3-TV5 Verification

Timestamp: `2026-08-26`

### Lint, Typecheck, Tests, Build

```text
npm run lint
exit: 0

npm run typecheck
exit: 0

npx vitest run tests/event-flush.test.ts
Test Files  1 passed (1)
Tests  10 passed (10)

npx vitest run tests/auth-telemetry-hardening.test.ts tests/restaurant-login-build.test.ts
Test Files  2 passed (2)
Tests  19 passed (19)

npm test
Test Files  70 passed (70)
Tests  387 passed (387)

npm run build
exit: 0
client, SSR, Nitro Vercel: built
warnings: vite-tsconfig-paths deprecation guidance; node:crypto browser externalization from src/lib/restaurant-session.server.ts

git diff --check
exit: 0
output: LF-to-CRLF warnings only for modified files
```

Parallel `npm test` and `npm run build` produced transient Nitro output-directory race (`ENOTEMPTY`/unresolved generated SSR assets). Sequential rerun passed; root cause was shared generated build folder, not source failure.

### Edge Function Check

```text
Get-Command deno
exit: 1
deno not recognized

npm run check:edge
exit: 1
'deno' is not recognized as an internal or external command
```

Status: **BLOCKED/UNVERIFIED**. Deno is absent, so Edge Function compile check cannot run locally. No fallback pass was added.

### Diff and Secret Pattern Scan

```text
git status --short
modified: 58 files
untracked: 27 files

git diff --stat
58 files changed, 1641 insertions(+), 426 deletions(-)

git diff -- . ':(exclude)package-lock.json' | rg -n "(?i)(api[_-]?key|secret|password|passwd|token|service_role|bearer|authorization|supabase_access_token|aws_access_key|private[_-]?key|BEGIN (RSA|OPENSSH|PRIVATE) KEY)"
```

Scan matched only code identifiers, env variable names, placeholders, docs warnings, and test strings. No raw secret value was found in diff output reviewed.

## TV7: Staging Runtime Verification (2026-08-27)

Project: `kjzxtmxdbcanvkgqqdow` (table-talker-staging, ACTIVE_HEALTHY, ap-southeast-1)
Token: Supabase personal access token (server-side only, never printed)
Encryption key: generated for staging, stored in `scripts/restaurant-credential-keys/staging.env`

### Migrations

```bash
npx supabase db push --include-all --linked
# Applied 15 pending migrations (total 37 in project)
# 0 failures
```

### Restaurant Provisioning

```bash
# 1 restaurant: KAMPUNG-BULU (33916a05-7e95-42fa-bc3c-050bed2402c5)
# code_hash:    hmac-sha256:v1:xjPm8Jcs1WM-IHXF6WDx30KCLIumqs_wJKjvOV2gfLw
# code_encrypted: aes-256-gcm:v1:...
# credential_rotated_at: 2026-08-27T18:24:48+07:00
# is_active: true
# Provisioned via provision_restaurant_credentials RPC (service_role)
```

### Table Existence

| Table | Status |
|---|---|
| owner_retention_scheduler_state | EXISTS |
| restaurant_credential_audit | EXISTS |
| owner_broadcasts | EXISTS |
| crew_session_tokens | EXISTS |
| restaurant_access_tokens | EXISTS |
| login_rate_limits | EXISTS |

### RPC Functions

| RPC | Result |
|---|---|
| run_owner_retention | Returns summary JSON (errors_deleted, playback_deleted, broadcasts_deleted, owner_login_rate_limits, credential_audit_deleted, tenant_login_rate_limits) |
| cleanup_owner_retention | Returns counters (errors_deleted, playback_deleted, broadcasts_deleted, credential_audit_deleted) |
| expire_remote_commands | Returns 0 (no expired commands) |
| login_to_restaurant_atomic | 404 via anon (expected: service_role only) |
| create_or_get_owner_broadcast | 404 via anon (expected: service_role only) |
| provision_restaurant_credentials | Void success (restaurant provisioned) |

### pgcrypto

pgcrypto installed in `extensions` schema (not `public`). RPC functions reference `extensions.*` internally — correct behavior.

### Edge Function

```
Owner-retention deployed to kjzxtmxdbcanvkgqqdow
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY auto-injected by Supabase (not set via secrets set — reserved env names)
```

### Scheduler State

```json
{
  "scheduler_name": "owner-retention-daily",
  "mode": "pg_cron",
  "schedule": "17 3 * * *",
  "last_success_at": null,
  "last_result": {"scheduler": "pg_cron"}
}
```

### Known Limitations (staging)

- pg_cron cron.job not directly queryable (Hobby plan may not expose `cron` schema to anon)
- `login_to_restaurant_atomic` and `create_or_get_owner_broadcast` only callable via service_role
- `gen_random_bytes` not exposed as REST RPC (internal to pgcrypto, used by DB functions)
