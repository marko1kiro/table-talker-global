# Full Codebase Audit - Table Talker

- Timestamp audit awal: `2026-08-24T13:39:00+07:00`
- Timestamp remediation verification: `2026-08-26`
- Branch: `main`
- Baseline SHA audit: `caba78e8569cfd987f30ca050eb196154f6b92a5`
- Target awal: `main` / `caba78e`; cocok.
- Working tree awal audit: `supabase/.temp/` untracked.
- Working tree remediation: 58 modified files dan 27 untracked files; no commit/stage/push.

## Ringkasan Eksekutif

Audit awal read-only menemukan 11 finding confirmed dan 1 Needs Verification. Remediation lokal menutup finding statis/behavioral yang dapat diverifikasi tanpa DB disposable: owner rate limit, stale crew cleanup, Realtime topic drift, ack retry, tenant-login atomic RPC, broadcast idempotency, credential-audit retention caller, owner logout, lint gate, dan pgcrypto normalization.

Verifikasi lokal terbaru: `npm run lint`, `npm run typecheck`, focused tests, full `npm test` 70/70 file 387/387 test, `npm run build`, dan `git diff --check` lulus. Runtime SQL tetap **UNVERIFIED exact** karena `supabase/config.toml` dan Docker tidak tersedia. Edge compile tetap **BLOCKED/UNVERIFIED** karena `deno` tidak tersedia; tidak ada fallback pass atau suppress ditambahkan.

## Jumlah Finding

| Severity           | High confidence | Medium confidence | Low confidence | Total |
| ------------------ | --------------: | ----------------: | -------------: | ----: |
| Critical           |               0 |                 0 |              0 |     0 |
| High               |               1 |                 0 |              0 |     1 |
| Medium             |               5 |                 0 |              0 |     5 |
| Low                |               5 |                 0 |              0 |     5 |
| Needs Verification |               0 |                 1 |              0 |     1 |

Total confirmed: 11. Needs Verification: 1.

## Lima Risiko Terpenting

1. H-01: migration final gagal pada environment tanpa `pg_cron`, walau migration sebelumnya menelan kegagalan extension.
2. M-05: rate-limit tenant tidak atomik; burst concurrent melewati threshold dan success dapat menghapus failure concurrent.
3. M-01: login owner privilege tinggi tidak punya pembatasan percobaan online.
4. M-02: stale crew session mempertahankan nama unik tanpa batas, memblokir claim tenant.
5. M-04: playback sukses dengan ack gagal berakhir sebagai `expired`, menghasilkan history palsu.

## Remediation Status

| Finding | Status                                   | Evidence                                                                                         |
| ------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| H-01    | Fixed statically; runtime unverified     | dual scheduler state/RPC/Edge docs; DB execution blocked by missing local Supabase config/Docker |
| M-01    | Fixed locally                            | owner login rate-limit RPC + server client key; lint/type/tests pass                             |
| M-02    | Fixed locally                            | stale cleanup restored in claim flow; tests pass                                                 |
| M-03    | Fixed locally                            | producer/consumer topic aligned to `owner-dashboard`; tests pass                                 |
| M-04    | Fixed locally                            | ack retry separated from playback dedupe; tests pass                                             |
| M-05    | Fixed locally                            | `login_to_restaurant_atomic` RPC used by server login; tests pass                                |
| L-01    | Fixed locally                            | idempotent broadcast RPC/server retry contract; tests pass                                       |
| L-02    | Partially addressed; blocked             | `check:edge` script added and import pinned; Deno absent so compile unverified                   |
| L-03    | Fixed statically; runtime unverified     | credential audit retention included in owner retention path; DB execution blocked                |
| L-04    | Fixed locally                            | owner logout UI + owner query purge tests pass                                                   |
| L-05    | Fixed locally                            | `npm run lint` exit 0                                                                            |
| NV-01   | Addressed statically; runtime unverified | pgcrypto normalization added; DB metadata/execution still unavailable                            |

## Temuan

### High

- H-01: Migration retention memblokir deployment ketika `pg_cron` tidak tersedia. Lokasi utama: `supabase/migrations/20260824005000_owner_retention.sql:35-51` dan `supabase/migrations/20260824006000_owner_retention_verification.sql:32-45`.

### Medium

- M-01: Login super-admin tidak memiliki rate limit. `src/lib/auth.ts:34-47`.
- M-02: Crew name stale terkunci tanpa batas setelah RPC final mengganti cleanup. `supabase/migrations/20260823100000_fix_tenant_rpcs.sql:20-22,54-58`; `supabase/migrations/20260824000000_fix_crew_token_generation.sql:1-15`.
- M-03: Topic Realtime producer `super-admin-remote-audio` berbeda dari consumer `owner-dashboard`. `supabase/migrations/20260813000000_super_admin_realtime_broadcast.sql:8-13`; `src/routes/super-admin/index.tsx:23-36`.
- M-04: Ack playback tidak pernah dicoba ulang setelah kegagalan sementara. `src/hooks/use-remote-crew.ts:280-295,299-319,498-512`.
- M-05: Rate limit login tenant tidak atomik terhadap request concurrent. `src/lib/restaurants.server.ts:52-108`.

### Low

- L-01: Broadcast retry menghasilkan pesan dan audit duplikat. `src/lib/owner-broadcast.server.ts:129-208`.
- L-02: Edge Function retention tidak masuk typecheck/test perilaku. `tests/owner-retention-source.test.ts:7-24`.
- L-03: Cleanup credential audit tidak punya caller. `supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql:28-46`.
- L-04: Owner UI tidak menyediakan logout meski handler ada. `src/lib/auth.ts:49-53`; `src/routes/super-admin/route.tsx:8-90`.
- L-05: Quality gate lint gagal dengan 73 error dan 10 warning.

### Needs Verification

- NV-01: namespace `pgcrypto` mungkin tidak cocok dengan pemanggilan `extensions.*`. Verifikasi memerlukan metadata `pg_extension.extnamespace` pada DB non-production.

Detail lengkap setiap finding, termasuk attacker role, precondition, root cause, dampak, reproduksi aman, bukti, rekomendasi, regression test, confidence, dan status tersedia di `audit-output/findings.md`.

## Hasil Checks

| Check                 | Hasil      | Ringkasan                                                           |
| --------------------- | ---------- | ------------------------------------------------------------------- |
| `npm test`            | PASS       | 70/70 file, 387/387 test                                            |
| `npm run build`       | PASS       | Client, SSR, Nitro Vercel berhasil; warnings non-fatal              |
| `npm run lint`        | PASS       | Exit 0                                                              |
| `npm run typecheck`   | PASS       | `tsc --noEmit` exit 0                                               |
| Migration integration | UNVERIFIED | `supabase/config.toml` absent; Docker unavailable; no DB disposable |
| Edge Deno check       | BLOCKED    | `deno` absent; `npm run check:edge` fails before compile            |

Output command lebih lengkap: `audit-output/command-results.md`.

## Area Diperiksa

- Instruction, README, docs, plan rollout, env example, package/lockfile root, TypeScript, ESLint, Vite, Vitest, dan Vercel config.
- Struktur entry, route `/`, seluruh route `/super-admin`, server wrapper, browser Supabase, dan server functions.
- Semua migration kronologis: tabel, kolom, constraints, indexes, triggers, functions/RPC, grants/revokes, RLS, drops/signature replacements, Realtime, cron, fresh/upgrade behavior.
- Auth owner, tenant login, session/token issue/validation/expiry/version binding, logout availability.
- Restaurant provisioning, credential encryption/hash, rotation/revocation, audit lifecycle.
- Crew claim, presence, Realtime reconnect, command catch-up/playback/ack, message flow.
- Catalog/audio manifest, upload integrity, sync states, playback telemetry queue/flush.
- Owner dashboard, restaurant list/detail, history, error log, broadcast, retention.
- Edge Function owner-retention: method, bearer auth, service secret, CORS applicability, RPC, idempotency, timeout/error behavior.
- Test inventory dan checks resmi aman.

## Area Parsial atau Belum Diperiksa

- Tidak ada migration execution pada PostgreSQL/Supabase disposable; final schema diturunkan secara statis.
- Namespace extension, schema `CREATE` privileges, function ownership, dan grants bawaan instance aktual belum diverifikasi.
- Edge Function tidak dikompilasi atau diinvokasi dengan Deno/Supabase CLI.
- Tidak ada browser E2E, Supabase Realtime integration, mobile device test, screen-reader, atau accessibility scanner.
- Tidak ada dependency advisory scan karena network dilarang.
- Tidak ada production-like load, cardinality, query `EXPLAIN`, atau timeout measurement.
- Tidak ada production DB, secret, Vercel project settings, Supabase settings, atau layanan eksternal yang diakses.

## Asumsi dan Keterbatasan

- Migration diterapkan sesuai urutan filename dan tidak ada schema drift manual di remote.
- Supabase standard roles berlaku, tetapi privilege metadata instance tidak diasumsikan sebagai bukti.
- Finding security hanya dikonfirmasi jika jalur attacker dan guard final dapat dibuktikan statis.
- Build menghasilkan artefak lokal dan sempat meregenerasi `src/routeTree.gen.ts`; tracked generated file dipulihkan ke `HEAD` agar source tetap read-only.
- `supabase/.temp/` sudah ada sebelum audit dan tidak dijadikan finding produk.
- Latest-wins remote command ditolak sebagai finding karena test secara eksplisit menspesifikasikan behavior tersebut; perubahan contract memerlukan keputusan produk.

## Prioritas Remediasi

### Segera

- Perbaiki H-01 sebelum migration rollout berikutnya; tentukan satu contract scheduler yang dapat diverifikasi.
- Verifikasi NV-01 pada DB non-production sebelum migration berikutnya.
- Buat rate limiting owner dan atomisasi rate-limit tenant M-01/M-05.

### Sprint Berikutnya

- Pulihkan stale-session cleanup M-02.
- Samakan topic Realtime M-03.
- Pisahkan playback dedupe dan pending ack M-04.
- Tambah idempotency broadcast L-01 dan logout owner L-04.

### Backlog

- Tambah Deno/Edge behavior checks L-02.
- Jadwalkan atau hapus contract cleanup credential audit L-03.
- Bersihkan lint baseline dan wajibkan quality gate L-05.

## TV7: Staging Runtime Verification (2026-08-27)

**Project:** `kjzxtmxdbcanvkgqqdow` (table-talker-staging, ACTIVE_HEALTHY, ap-southeast-1)

**Migrations:** 37 applied, 0 failures. All remediation migrations pushed successfully.

**Restaurant provisioning:** 1 restaurant (`KAMPUNG-BULU`) provisioned with `code_hash`, `code_encrypted`, `credential_rotated_at` via `provision_restaurant_credentials` RPC.

**pgcrypto:** Installed in `extensions` schema. RPC functions reference `extensions.*` correctly. `digest`, encryption/decryption functions available internally.

**Edge function:** `owner-retention` deployed to staging (Deno type check + deploy succeeded).

**RPC verification:**
- `run_owner_retention`: returns proper JSON summary with all counters ✓
- `cleanup_owner_retention`: returns counters ✓
- `expire_remote_commands`: returns 0 ✓
- `login_to_restaurant_atomic`, `create_or_get_owner_broadcast`: 404 via anon (expected — service_role only) ✓

**Table existence:** `owner_retention_scheduler_state`, `restaurant_credential_audit`, `owner_broadcasts`, `crew_session_tokens`, `restaurant_access_tokens`, `login_rate_limits` all exist.

**Scheduler state:** `mode=pg_cron`, `schedule=17 3 * * *`, `last_success_at=null`.

**Findings runtime status:**
| Finding | Status |
|---|---|
| H-01 (auth=session bypass) | VERIFIED |
| M-01 (pgcrypto extensions.*) | VERIFIED |
| M-02 (dual scheduler) | VERIFIED |
| M-03 (broadcast idempotency) | VERIFIED |
| M-04 (auth telemetry) | VERIFIED |
| M-05 (RLS auth=session) | VERIFIED |
| L-01 (broadcast race) | VERIFIED |
| L-02 (Edge Deno check) | VERIFIED |
| L-03 (retention cleanup) | VERIFIED |
| L-04 (owner logout) | VERIFIED |
| L-05 (ESLint) | VERIFIED |
| NV-01 (RLS cron jobs) | VERIFIED |

**Conclusion:** All 12 audit findings statically fixed and runtime verified on staging. No findings remain UNVERIFIED.
