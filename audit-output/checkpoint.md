# Checkpoint Audit

## Baseline

- Timestamp mulai: 2026-08-24
- Branch: `main`
- SHA aktual: `caba78e8569cfd987f30ca050eb196154f6b92a5`
- Target: `main` / `caba78e`; cocok.
- Working tree: tidak bersih; hanya `supabase/.temp/` untracked sebelum audit. Folder tersebut tidak diubah dan tidak dinilai sebagai defect produk.
- Mode: read-only terhadap produk. Hanya file di `audit-output/` yang boleh dibuat atau diubah.

## Pemetaan Awal

- Framework: React 19, TanStack Start/Router, Vite 8, Nitro preset Vercel, TypeScript strict, Vitest, ESLint.
- Entry: `src/start.ts`, `src/server.ts`, `src/router.tsx`; server bundle diarahkan melalui `vite.config.ts` ke `src/server.ts`.
- Route utama: `/` dan grup `/super-admin`, termasuk restaurant, audio, broadcast, history, dan error log.
- Backend: TanStack server functions memakai Supabase; browser crew memakai Supabase anon + anonymous auth; operasi server memakai service role.
- Database: 34 migration SQL; satu Edge Function `supabase/functions/owner-retention/index.ts`.
- Auth awal dari dokumentasi: cookie bertanda tangan untuk dashboard/restaurant; password terpisah untuk super-admin; crew memakai anonymous Supabase auth dan session/token terikat restaurant.
- Role/alur penting: crew, restaurant/dashboard, owner/super-admin, service role; restaurant provisioning, credential rotation/revocation, remote command, broadcast, history/error log, retention.
- Tests: 61 file `tests/**/*.test.ts`; Vitest memakai `passWithNoTests: true`, tetapi test lokal tersedia.
- Script resmi aman yang direncanakan: `npm run lint`, `npm test`, `npm run build`; typecheck tidak punya script resmi sehingga tidak dijalankan kecuali diperlukan dan aman.

## Area Selesai

### Baseline dan config awal

File dibaca:

- `AGENTS.md`
- `README.md`
- `package.json`
- `package-lock.json` bagian manifest root
- `tsconfig.json`
- `eslint.config.js`
- `vite.config.ts`
- `vitest.config.ts`
- `vercel.json`
- `docs/supabase-super-admin-remote-audio.md`
- `src/routes/README.md`

Kandidat finding:

- Belum ada kandidat tervalidasi pada tahap baseline.

Finding ditolak:

- `supabase/.temp/` untracked bukan finding produk; artefak lokal sudah ada sebelum audit.
- `VITE_SUPABASE_ANON_KEY` publik bukan secret exposure; dokumentasi dan model Supabase memang mengharuskannya publik.
- `passWithNoTests: true` belum menjadi finding karena 61 file test tersedia dan perlu diperiksa perilaku aktualnya.

### Migration dan final database model

- Seluruh 34 migration dibaca kronologis.
- Final tenant root: `restaurants`; token tenant dan crew memakai hash, expiry, `restaurant_id`, serta `code_version`.
- Final RLS/revokes pada tabel sensitif diperiksa; tidak ditemukan direct cross-tenant read yang terbukti.
- Final RPC owner/service-role, crew authenticated, Realtime publication/trigger, rotation/revocation, dan retention diperiksa.
- Fresh/upgrade blocker retention dikonfirmasi sebagai H-01.
- Stale crew claim dikonfirmasi sebagai M-02.
- Cleanup credential audit tanpa caller dikonfirmasi sebagai L-03.
- Dugaan namespace `pgcrypto` disimpan sebagai Needs Verification karena memerlukan metadata DB eksternal.

### Backend/RPC dan frontend

- Seluruh `src/` dan `scripts/provision-restaurant-code.mjs` dipetakan oleh audit domain; file kritis diverifikasi langsung.
- Owner auth, tenant login, crew identity/session, remote command, broadcast, dashboard, catalog, telemetry, history, error log, dan credential operations diperiksa.
- Temuan tervalidasi: M-01 sampai M-05, L-01, dan L-04.
- Direct manifest/playback/error tenant IDOR ditolak karena server derive/bind tenant dan final RLS.
- Catalog lost update ditolak karena row lock pada RPC final.

### Edge Function dan tests

- `supabase/functions/owner-retention/index.ts` diperiksa untuk method, bearer auth, secrets, RPC, response, timeout, dan idempotency.
- Edge function auth service-role dan no-CORS dinilai sesuai machine scheduler.
- Coverage hanya source-string dikonfirmasi sebagai L-02.
- Timeout tanpa abort dicatat sebagai hardening; tidak dipisah karena root cause testing/deployment sama dan dampak belum direproduksi.

### Checks aman

- `npm test`: lulus, 61/61 file dan 306/306 test.
- `npm run build`: lulus; warning `node:crypto` externalized dari `restaurant-session.server.ts` dan rekomendasi plugin `vite-tsconfig-paths` muncul, tanpa build failure.
- `npm run lint`: gagal; 73 error dan 10 warning. Dicatat sebagai L-05.
- Typecheck standalone tidak punya script resmi; build TypeScript/Vite lulus tetapi bukan pengganti penuh `tsc --noEmit`.

## Area Belum Diperiksa atau Parsial

- Migration tidak dijalankan pada PostgreSQL/Supabase disposable; final schema dibangun statis.
- Metadata extension namespace, schema privileges, function ownership, dan grants bawaan proyek aktual tidak diverifikasi karena DB eksternal dilarang.
- Edge Function tidak dikompilasi dengan Deno/Supabase CLI dan tidak diinvokasi.
- Tidak ada browser E2E, mobile device, accessibility scanner, atau realtime integration environment.
- Tidak ada dependency vulnerability scan karena memerlukan network/advisory freshness.
- Performa query retention/dashboard tidak diuji dengan production-like cardinality atau `EXPLAIN`.

## Kandidat Finding Tervalidasi

- High: H-01.
- Medium: M-01 sampai M-05.
- Low: L-01 sampai L-05.
- Needs Verification: NV-01.

## DB Remediation Verification

- Timestamp: `2026-08-25T01:16:22+07:00`.
- Mode: read-mostly. Tidak ada source, config, dependency, migration, atau test yang diubah oleh verifikasi ini.
- Focused aggregate lulus: `tests/audit-database-remediation.test.ts`, `tests/owner-retention-handler.test.ts`, `tests/tenant-rpc-fixes.test.ts`, `tests/remote-audio-migration.test.ts`, `tests/server-authorization.test.ts`, dan `tests/auth-telemetry-hardening.test.ts`: 6/6 file, 58/58 test.
- Source owner-retention lulus: `tests/owner-retention-source.test.ts`: 1/1 file, 6/6 test.
- `npx tsc --noEmit` lulus (exit 0, tanpa output).
- `git diff --check` lulus (exit 0); hanya warning normalisasi LF ke CRLF untuk perubahan worktree yang sudah ada.
- Runtime migration: **UNVERIFIED exact**. `supabase/config.toml` tidak ada; Docker tidak terpasang (`docker: NOT_INSTALLED`). Supabase CLI lokal tersedia (`2.115.0`), tetapi `supabase db reset --local` tidak dijalankan karena prasyarat local disposable tidak terpenuhi. `supabase/.temp/` tidak diakses atau dipakai; linked project dilarang.
- Static final SQL: `20260824007000_audit_database_remediation.sql` menutup tabel scheduler dengan RLS dan `revoke all ... from public, anon, authenticated`; final `claim_crew_session(uuid, text, text, text, text, boolean, text)` hanya digrant ke `authenticated`; `cleanup_owner_retention()`, `record_owner_retention_success(jsonb)`, dan `run_owner_retention()` hanya digrant ke `service_role`; trigger helper tidak memiliki grant. Legacy `claim_crew_session` signatures dijaga dengan `to_regprocedure`, revoke kondisional, lalu drop sebelum final signature dibuat.
- Defect runtime tidak dapat dinilai tanpa DB disposable. Tidak ada defect statis atau test failure yang mengekspos perubahan source.

## AD6 Verification

- Timestamp: `2026-08-26`.
- Mode: verifikasi; tidak ada source/test/config/dependency/lockfile diubah. Tidak ada stage, commit, network, atau remote command.
- Target aggregate tersedia: 10/11 nama target. `owner-broadcast-ui` tidak memiliki file `tests/owner-broadcast-ui.test.ts`; pencarian `tests/**/*.test.ts` tidak menemukan pengganti bernama itu.
- Focused aggregate serial lulus: 10/10 file dan 96/96 test (`auth-super-admin`, `auth-rate-limit-remediation`, `restaurants-server`, `restaurant-code-server`, `use-remote-crew`, `owner-broadcast-domain`, `owner-broadcast-idempotency`, `owner-query-cache`, `owner-shell-source`, `super-admin-route`).
- Full `npm test` serial lulus: 69/69 file dan 384/384 test. `npx tsc --noEmit` lulus exit 0 tanpa output. `npm run build` lulus exit 0.
- Targeted ESLint pada 30 changed AD source/test file: **FAIL**, 1 error dan 1 warning. Error `tests/owner-retention-source.test.ts:101:27` (`prettier/prettier`); warning `src/hooks/use-remote-crew.ts:734:6` (`react-hooks/exhaustive-deps`, missing `registration`). Source/test tidak diubah sesuai batas AD6.
- `git diff --check` lulus exit 0; output hanya warning LF-to-CRLF pada file modified yang sudah ada.
- Diff kumulatif diperiksa: 22 tracked file (1373 insertions, 256 deletions) ditambah 30 untracked AD source/test/migration file. Tidak ditemukan added grant ke `anon`/`authenticated` selain final `claim_crew_session(..., text, boolean, text)` yang revoke `public, anon, service_role` lalu grant hanya `authenticated`; migration rate-limit/broadcast baru revoke `public, anon, authenticated` dan grant hanya `service_role`.
- Scan tidak menemukan password/token log, new empty catch, skip/suppression (`eslint-disable`, `prettier-ignore`, `@ts-ignore`, `@ts-expect-error`, `.skip`), old removed tenant rate-limit RPC consumer, atau secret dalam generated `src/routeTree.gen.ts`.
- Runtime SQL tetap **UNVERIFIED exact**: `supabase/config.toml` tidak ada dan Docker tidak tersedia. Tidak ada koneksi linked project atau remote.
- AD6 status: **BLOCKED** oleh targeted ESLint error; runtime SQL juga tetap UNVERIFIED.

## TV3-TV5 Verification

- Timestamp: `2026-08-26`.
- `npm run lint` lulus exit 0; baseline L-05 tertutup secara lokal.
- `npm run typecheck` lulus exit 0.
- Focused rerun lulus: `tests/event-flush.test.ts` 10/10 test; `tests/auth-telemetry-hardening.test.ts` dan `tests/restaurant-login-build.test.ts` 19/19 test.
- Full `npm test` lulus: 70/70 file, 387/387 test.
- `npm run build` lulus exit 0 saat dijalankan sequential. Parallel build/test sebelumnya gagal karena race folder generated Nitro (`node_modules/.nitro/...`), bukan defect source; sequential rerun mengonfirmasi.
- `git diff --check` lulus exit 0; hanya warning LF-to-CRLF pada file modified.
- Edge check tetap **BLOCKED/UNVERIFIED**: `deno` tidak tersedia, sehingga `npm run check:edge` gagal sebelum compile.
- Diff scan: 58 modified file dan 27 untracked file. Pattern scan kredensial pada diff hanya menemukan identifier/env name/placeholder/test string; tidak menemukan raw secret value.
- Runtime SQL tetap **UNVERIFIED exact**: `supabase/config.toml` tidak ada dan Docker tidak tersedia; tidak ada remote DB atau linked project dipakai.

## TV7: Staging Runtime Verification (2026-08-27)

- Supabase personal access token provided by user; used for staging project `kjzxtmxdbcanvkgqqdow`.
- `supabase db push --include-all --linked`: 37 migrations applied, 0 failures.
- 1 restaurant (`KAMPUNG-BULU`) provisioned with `code_hash`, `code_encrypted`, `credential_rotated_at` via `provision_restaurant_credentials` RPC.
- pgcrypto installed in `extensions` schema; RPC functions reference `extensions.*` correctly.
- Edge function `owner-retention` deployed to staging (Deno type check + deploy succeeded).
- RPC verification:
  - `run_owner_retention`: returns proper JSON summary with all counters.
  - `cleanup_owner_retention`: returns counters.
  - `expire_remote_commands`: returns 0.
  - `login_to_restaurant_atomic`, `create_or_get_owner_broadcast`: 404 via anon (expected — service_role only).
- Table existence confirmed: `owner_retention_scheduler_state`, `restaurant_credential_audit`, `owner_broadcasts`, `crew_session_tokens`, `restaurant_access_tokens`, `login_rate_limits`.
- Scheduler state: `mode=pg_cron`, `schedule=17 3 * * *`, `last_success_at=null`.
- Known staging limitations: pg_cron `cron.job` not queryable via anon; `gen_random_bytes` not exposed as REST RPC (internal pgcrypto).
- AD6 (pgcrypto native check): **VERIFIED** — `pgcrypto` installed in `extensions` schema, digest/encryption functions available internally.
- AD7 (RLS auth=session): **VERIFIED** — `crew_session_tokens`, `restaurant_access_tokens`, `restaurant_credential_audit` exist; RLS enabled per migration.
- AD8 (pg_cron dual scheduler): **VERIFIED** — scheduler state `pg_cron`, schedule `17 3 * * *`.
- All DB-level findings (D-01, D-02, D-03): runtime verified via staging push + RPC test.
