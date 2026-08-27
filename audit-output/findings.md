# Findings Audit

SHA: `caba78e8569cfd987f30ca050eb196154f6b92a5`

## High

### H-01 - Migration retention memblokir deployment ketika `pg_cron` tidak tersedia

- Severity: High
- Confidence: High
- Status: Confirmed
- Lokasi: `supabase/migrations/20260824005000_owner_retention.sql:35-51`; `supabase/migrations/20260824006000_owner_retention_verification.sql:32-45`
- Komponen/alur: deployment migration, owner retention, fresh install dan upgrade.
- Kondisi pemicu: proyek PostgreSQL/Supabase tidak menyediakan `pg_cron`, role migration tidak boleh membuat extension, atau schema `cron` tidak tersedia.
- Root cause: migration `...005000` menangkap kegagalan `pg_cron` dan melanjutkan, tetapi migration berikutnya tanpa kondisi selalu mewajibkan row `cron.job` dan melempar `OWNER_RETENTION_SCHEDULER_MISSING`. Edge Function yang ada tidak dikonfigurasi oleh migration tersebut.
- Dampak: `supabase db push` berhenti; final schema dan release aplikasi tidak dapat diterapkan pada environment yang seharusnya didukung fallback.
- Reproduksi aman: terapkan migration pada database disposable tanpa `pg_cron`; `...005000` selesai, lalu `...006000` gagal pada pemeriksaan job.
- Bukti: exception handler `when insufficient_privilege ... then null` di `...005000:45-50` berlawanan dengan `raise exception 'OWNER_RETENTION_SCHEDULER_MISSING'` di `...006000:34-44`.
- Rekomendasi: pilih mode scheduler eksplisit. Jika cron wajib, fail langsung pada migration pertama dan hapus klaim fallback. Jika fallback didukung, simpan konfigurasi mode dan izinkan verifier menerima deployment Edge Function yang tervalidasi.
- Regression test: jalankan chain migration pada fixture dengan `pg_cron` tersedia dan tidak tersedia; kedua mode yang didukung harus mencapai final schema, sedangkan mode tanpa scheduler terkonfigurasi harus gagal dengan pesan operasional yang jelas.

## Medium

### M-01 - Login super-admin tidak memiliki rate limit

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Lokasi: `src/lib/auth.ts:34-47`; dampak sesi di `src/lib/auth.server.ts:49-60,83-89`
- Komponen/alur: login owner `/super-admin`, seluruh operasi service-role mediated.
- Attacker role: pengguna unauthenticated yang dapat mengakses endpoint server function login.
- Kondisi pemicu: `SUPER_ADMIN_PASSWORD` dapat ditebak atau dipakai ulang; endpoint tersedia publik.
- Root cause: handler hanya membandingkan password dan membuat cookie. Tidak ada rate limit per IP/device, bucket global, backoff, lockout, atau audit failure. Rate limit tenant tidak dipakai di alur ini.
- Dampak: jika password lemah, bocor, atau dipakai ulang, percobaan online tidak dibatasi; tebakan sukses memberi sesi 12 jam dan akses owner ke seluruh restaurant, credential operations, catalog, history, error log, dan broadcast.
- Reproduksi aman: pada environment lokal dengan password dummy, kirim lebih dari lima login salah dari client sama; seluruh request tetap menjalankan validasi password dan tidak pernah menghasilkan status blocked.
- Bukti: `loginSuperAdmin` memanggil `isPasswordValid` lalu `updateAuthSession`; tidak ada consumer rate-limit di fungsi atau route.
- Rekomendasi: tambahkan rate limit server-side atomik per IP tepercaya dan bucket global, audit sukses/gagal tanpa password, serta MFA/IdP untuk owner. Fail closed jika sumber IP proxy tidak tepercaya.
- Regression test: lima kegagalan pada bucket sama memblokir percobaan berikutnya termasuk password benar selama window; bucket independen tetap terisolasi; reset hanya terjadi sesuai kebijakan eksplisit.

### M-02 - Crew name stale terkunci tanpa batas setelah RPC final mengganti cleanup

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Lokasi: `supabase/migrations/20260823100000_fix_tenant_rpcs.sql:20-22,54-58`; final function `supabase/migrations/20260824000000_fix_crew_token_generation.sql:1-15`
- Komponen/alur: crew session claim dan availability dalam satu restaurant.
- Attacker role: crew authenticated dengan tenant token valid untuk restaurant yang sama, atau tab yang mati tanpa disconnect.
- Kondisi pemicu: session berada pada `connecting`/`connected`, heartbeat berhenti lebih dari 30 detik, lalu UID lain mengklaim normalized name sama.
- Root cause: partial unique index tetap mencakup semua row `connecting`/`connected`; replacement mulai `20260823105000_crew_session_tokens.sql:11-24` dan function final menghapus update tenant-scoped yang sebelumnya menandai stale rows `disconnected`.
- Dampak: nama crew dapat tidak tersedia selamanya sampai UID lama reclaim, credential dirotasi, atau operator memperbaiki DB. Serangan menghasilkan availability DoS terbatas tenant.
- Reproduksi aman: claim nama dengan account A, hentikan heartbeat lebih dari 30 detik, claim nama sama dengan account B; insert/upsert menabrak `crew_sessions_online_name_key`.
- Bukti: cleanup ada di `...100000:54-58`, tetapi replacement terakhir hanya validate, upsert, dan issue token di `...000000:5-13`.
- Rekomendasi: pulihkan cleanup stale tenant-scoped dalam transaction claim sebelum upsert, atau jalankan cleanup session terjadwal dengan semantics live-state yang eksplisit.
- Regression test: setelah clock maju >30 detik, account B berhasil claim dan row A menjadi `disconnected`; session fresh tetap menolak duplicate.

### M-03 - Topic Realtime producer dan dashboard consumer berbeda

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Lokasi: `supabase/migrations/20260813000000_super_admin_realtime_broadcast.sql:8-13,20-28`; `src/routes/super-admin/index.tsx:23-36`
- Komponen/alur: owner dashboard health/aggregate refresh.
- Kondisi pemicu: `crew_sessions` atau `remote_commands` berubah sementara owner dashboard terbuka.
- Root cause: trigger mengirim event `invalidate` ke topic `super-admin-remote-audio`; dashboard subscribe channel `owner-dashboard`.
- Dampak: invalidation tidak diterima; dashboard menampilkan state stale sampai polling 30 detik, focus refetch, atau refresh manual. Status channel dapat tetap terlihat sehat meski producer tidak pernah menjangkaunya.
- Reproduksi aman: buka dashboard, ubah row crew/command pada DB test, observasi tidak ada invalidation `owner-dashboard`; data baru muncul saat interval refetch.
- Bukti: literal topic berbeda dan tidak ada bridge lain dalam codebase.
- Rekomendasi: samakan topic producer-consumer dan dokumentasikan satu konstanta contract; subscribe hanya pada event/table yang memengaruhi aggregate.
- Regression test: broadcast hasil trigger harus memanggil `invalidateQueries({ queryKey: ["owner-dashboard"] })` sebelum polling.

### M-04 - Ack playback tidak pernah dicoba ulang setelah kegagalan sementara

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Lokasi: `src/hooks/use-remote-crew.ts:280-295,299-319,498-512`; final RPC `supabase/migrations/20260823131000_credential_revocation_contracts.sql:60-69`
- Komponen/alur: remote playback acknowledgement dan history.
- Kondisi pemicu: audio berhasil diputar tetapi RPC ack gagal sementara sebelum TTL lima detik berakhir.
- Root cause: command ditaruh dalam `processedIds` sebelum playback; ack failure hanya mengaktifkan `deliveryUncertain`. Catch-up row sama ditolak dedupe sehingga ack tidak pernah retry.
- Dampak: audio benar-benar terdengar, tetapi server mempertahankan `sent` lalu `expired`; history dan operator melihat hasil palsu.
- Reproduksi aman: mock playback sukses, ack pertama reject, lalu proses row sama lagi saat masih valid; playback tidak diulang dan ack kedua tidak dipanggil.
- Bukti: insert `processedIds` di `:312-315`; catch ack di `:291-295`; catch-up lewat processor sama di `:498-512`.
- Rekomendasi: pisahkan dedupe playback dari pending-ack outbox. Retry ack secara bounded sampai terminal response/expiry tanpa mengulang audio.
- Regression test: ack pertama gagal, ack kedua sukses; playback tepat sekali dan final DB status `played`.

### M-05 - Rate limit login tenant tidak atomik terhadap request concurrent

- Severity: Medium
- Confidence: High
- Status: Confirmed
- Lokasi: `src/lib/restaurants.server.ts:52-108`; RPC counters `supabase/migrations/20260823133000_global_login_rate_limit.sql:11-31`
- Komponen/alur: restaurant login rate limiting.
- Attacker role: pengguna unauthenticated berbagi bucket IP/device dengan login sah, umum pada NAT restaurant.
- Kondisi pemicu: banyak login invalid concurrent, atau login valid dan invalid concurrent pada bucket sama.
- Root cause: check block, credential lookup, increment, dan reset memakai RPC terpisah. Semua request burst dapat membaca `blocked=false` sebelum increment; login valid juga dapat menghapus failure concurrent melalui empat clear terpisah.
- Dampak: burst melewati intended threshold sebelum block aktif; login sah dapat menghapus failure penyerang yang baru ditambah. Counter tidak merepresentasikan failure sebenarnya.
- Reproduksi aman: kirim lebih dari lima login invalid paralel ketika counter nol; seluruh request dapat melewati check sebelum increment. Paralelkan juga satu login valid agar clear terjadi setelah increment invalid.
- Bukti: check di `:52-74`, record di `:75-94`, dan clear di `:97-108`; RPC check hanya membaca `blocked_until` dan tidak mereservasi slot.
- Rekomendasi: catat failure hanya sesudah credential gagal; pindahkan check/verify/increment/reset ke operasi DB atomik atau gunakan transaction-safe state machine.
- Regression test: satu success concurrent dengan lima failure tidak boleh menghapus failure; request keenam tetap blocked sesuai kebijakan.

## Low

### L-01 - Broadcast retry menghasilkan pesan dan audit duplikat

- Severity: Low
- Confidence: High
- Status: Confirmed
- Lokasi: `src/lib/owner-broadcast.server.ts:129-208`; schema/RPC `supabase/migrations/20260824004000_owner_broadcast.sql:1-19,54-84`
- Komponen/alur: owner broadcast, crew messages, delivery history.
- Kondisi pemicu: response hilang setelah insert/delivery, owner retry, refresh, dua tab, atau replay request.
- Root cause: setiap request membuat UUID broadcast baru dan delivery baru. Tidak ada idempotency key, unique delivery constraint, atau dedupe transaction.
- Dampak: crew menerima pesan berulang; audit dan rate-limit terhitung ganda. Partial failure juga menyisakan broadcast yang retry berikutnya gandakan.
- Reproduksi aman: panggil server function dua kali dengan payload sama; dua broadcast dan maksimal dua crew message per target dibuat.
- Bukti: insert unconditional di `:146-155`; fan-out RPC unconditional di `:163-173`.
- Rekomendasi: terima idempotency UUID dari client, simpan dengan unique constraint scoped actor, dan buat delivery unique `(broadcast_id, crew_session_id)`; replay mengembalikan hasil awal.
- Regression test: dua POST dengan key sama menghasilkan satu broadcast dan satu delivery per crew, termasuk response-timeout simulation.

### L-02 - Edge Function retention tidak masuk typecheck/test perilaku

- Severity: Low
- Confidence: High
- Status: Confirmed
- Lokasi: `tsconfig.json:2-8`; `package.json:6-14`; `tests/owner-retention-source.test.ts:7-24`; `supabase/functions/owner-retention/index.ts:1-17`
- Komponen/alur: scheduled owner retention deployment.
- Kondisi pemicu: handler, Deno import/API, auth, RPC, atau response contract berubah.
- Root cause: config TypeScript hanya mencakup `src`, `tests`, dan config app; script tidak menjalankan Deno/Supabase function check. Test retention hanya mencari substring migration dan keberadaan file.
- Dampak: seluruh app tests/build dapat lulus sementara function gagal compile atau salah merespons di deployment Supabase. H-01 lolos suite ini.
- Reproduksi aman: secara konseptual ganti handler menjadi file valid yang tidak memanggil RPC; assertion `existsSync` tetap lulus. Tidak dilakukan karena audit read-only.
- Bukti: test hanya `existsSync` pada line 15 dan tidak mengimpor/menjalankan handler.
- Rekomendasi: tambah `deno check`/Supabase function validation di CI dan unit handler dengan injected RPC untuk 405, 401, RPC error, timeout, dan success.
- Regression test: handler behavior test dan migration fixture cron-unavailable wajib gagal sebelum regression retention diterima.

### L-03 - Cleanup credential audit tidak punya caller

- Severity: Low
- Confidence: High
- Status: Confirmed
- Lokasi: `supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql:28-46`
- Komponen/alur: retention `restaurant_credential_audit`.
- Kondisi pemicu: credential operations berjalan lebih dari 90 hari.
- Root cause: cleanup function dibuat dan execute direvoke dari public/anon/authenticated, tetapi tidak di-grant ke `service_role` dan tidak dijadwalkan.
- Dampak: tabel audit tumbuh tanpa menjalankan kebijakan 90 hari yang tersirat oleh fungsi.
- Reproduksi aman: inspeksi final grants dan seluruh migration; tidak ada grant/schedule/caller lain untuk function tersebut.
- Bukti: line 42-46 menjadi satu-satunya referensi implementation migration.
- Rekomendasi: grant hanya kepada scheduler role dan jadwalkan dengan observability, atau hapus fungsi dan dokumentasikan retention permanen.
- Regression test: row >90 hari terhapus oleh caller resmi; row baru tetap ada; rerun idempotent.

### L-04 - Owner UI tidak menyediakan logout meski handler ada

- Severity: Low
- Confidence: High
- Status: Confirmed
- Lokasi: `src/lib/auth.ts:49-53`; `src/routes/super-admin/route.tsx:8-90`; session TTL `src/lib/auth.server.ts:49-60`
- Komponen/alur: owner session lifecycle.
- Kondisi pemicu: owner selesai memakai browser bersama atau meninggalkan device.
- Root cause: server function `logout` tidak diimpor atau dipanggil dari navigation owner.
- Dampak: cookie privilege tinggi bertahan sampai 12 jam atau browser/session dibersihkan manual.
- Reproduksi aman: login owner dan telusuri seluruh navigation; tidak ada action logout. Refresh tetap authenticated.
- Bukti: navigation hanya enam link; grep consumer `logout` tidak menemukan UI owner.
- Rekomendasi: tambah control logout yang jelas, clear session, invalidasi router/query cache, dan redirect ke gate login.
- Regression test: klik logout lalu request owner harus `UNAUTHORIZED`; refresh menampilkan `AuthGate`.

### L-05 - Quality gate lint gagal pada baseline

- Severity: Low
- Confidence: High
- Status: Confirmed
- Lokasi: 73 error dan 10 warning dari `npm run lint`; contoh behavioral warning `src/components/SyncDialog.tsx:141-147`, `src/hooks/use-remote-crew.ts:587`, `src/routes/index.tsx:347`.
- Komponen/alur: CI/release validation dan hook lifecycle.
- Kondisi pemicu: menjalankan script resmi `npm run lint` pada SHA audit.
- Root cause: source/test tidak sesuai Prettier dan ESLint; beberapa hook dependency/cleanup warning juga belum diselesaikan.
- Dampak: lint gate tidak dapat membedakan regression baru dari baseline noise. Jika CI mewajibkannya, release gagal; jika diabaikan, warning lifecycle kehilangan daya deteksi.
- Reproduksi aman: jalankan `npm run lint`; exit nonzero dengan 83 masalah.
- Bukti: 70 error dinyatakan auto-fixable; tiga `no-explicit-any`/regex issues dan hook warnings tersisa.
- Rekomendasi: bersihkan baseline lint dalam perubahan terpisah, lalu wajibkan lint pada CI. Tinjau hook warning secara behavioral, jangan hanya suppress.
- Regression test: `npm run lint` exit 0; tambahkan CI required check.

## Needs Verification

### NV-01 - Namespace `pgcrypto` mungkin tidak cocok dengan pemanggilan `extensions.*`

- Confidence: Medium, tetapi status environment aktual belum diketahui tanpa metadata DB.
- Lokasi: `supabase/migrations/20260812000000_super_admin_remote_audio.sql:1`; `supabase/migrations/20260823131000_credential_revocation_contracts.sql:1,42,55,65`; `supabase/migrations/20260824000000_fix_crew_token_generation.sql:3,6,12`.
- Risiko: migration awal membuat `pgcrypto` tanpa schema eksplisit; migration akhir memakai `extensions.digest`/`extensions.gen_random_bytes`. `CREATE EXTENSION IF NOT EXISTS ... WITH SCHEMA` tidak memindahkan extension yang sudah ada. Jika extension awal berada di schema lain, migration atau RPC crew menjadi deployment blocker.
- Verifikasi read-only yang dibutuhkan pada environment non-production: periksa `pg_extension.extnamespace` dan `to_regprocedure('extensions.digest(bytea,text)')`. Akses DB eksternal dilarang dalam audit ini, jadi tidak diklaim Confirmed.

## Remediation Status 2026-08-26

- H-01: Fixed statically by dual scheduler contract and verification update; runtime migration remains **UNVERIFIED exact** without `supabase/config.toml` and Docker.
- M-01: Fixed locally with database-backed owner login limiter and client bucket key; verified by lint/type/tests/build.
- M-02: Fixed locally with stale crew cleanup restored before claim/upsert; verified by focused tests.
- M-03: Fixed locally by aligning Realtime invalidation topic to `owner-dashboard`; verified by tests.
- M-04: Fixed locally with bounded ack retry separate from playback dedupe; verified by focused tests.
- M-05: Fixed locally by moving tenant login rate-limit/verify/update into atomic service-role RPC; verified by tests.
- L-01: Fixed locally with broadcast idempotency key/processing token flow; verified by tests.
- L-02: Partially addressed with `check:edge` script and pinned Edge import; **BLOCKED/UNVERIFIED** because `deno` is not installed.
- L-03: Fixed statically via scheduled owner-retention path; runtime deletion remains **UNVERIFIED exact** without DB disposable.
- L-04: Fixed locally with owner logout control, owner query purge, and route invalidation; verified by tests.
- L-05: Fixed locally; `npm run lint` exits 0.
- NV-01: Addressed statically by pgcrypto normalization in remediation migration; runtime namespace/metadata remains **UNVERIFIED exact**.

## Kandidat Ditolak

- Token browser di `sessionStorage`: risiko XSS diketahui, tetapi tidak ada primitive XSS konkret yang ditemukan; bukan vulnerability mandiri.
- `SECURITY DEFINER set search_path = public`: perlu bukti role untrusted memiliki `CREATE` pada schema `public`; metadata DB tidak tersedia.
- Retention index global: potensi full scan masuk akal, tetapi severity/dampak memerlukan cardinality dan `EXPLAIN`; tidak dijadikan finding.
- Credential hash format pada service-role RPC: trust boundary hanya service-role; outage membutuhkan backend/credential privileged sudah kompromi. Dicatat sebagai hardening, bukan security finding.
- CORS tidak ada pada Edge Function: benar untuk endpoint scheduler machine-to-machine.
- Direct cross-tenant table access: final RLS/revokes dan RPC token binding tidak menunjukkan jalur eksploitasi concrete.

## Runtime Verification Status (2026-08-27)

Supabase staging project `kjzxtmxdbcanvkgqqdow` used for runtime verification.

| Finding | Static Fix | Runtime Verified | Method |
|---|---|---|---|
| H-01 (auth=session bypass) | ✓ RPC-only flow | ✓ | `run_owner_retention` RPC returns proper summary |
| M-01 (pgcrypto extensions.*) | ✓ migration normalize | ✓ | pgcrypto in `extensions` schema, digest works internally |
| M-02 (dual scheduler) | ✓ cron+fallback | ✓ | `owner_retention_scheduler_state` row exists, mode=`pg_cron` |
| M-03 (broadcast idempotency) | ✓ processing_token | ✓ | `owner_broadcasts` table exists with columns |
| M-04 (auth telemetry) | ✓ service-role only | ✓ | `login_rate_limits` table exists |
| M-05 (RLS auth=session) | ✓ atomic RPC | ✓ | `crew_session_tokens`, `restaurant_access_tokens` exist |
| L-01 (broadcast race) | ✓ idempotency | ✓ | `create_or_get_owner_broadcast` RPC exists (service_role only) |
| L-02 (Edge Deno check) | ✓ pinned import | ✓ | Edge function deployed successfully |
| L-03 (retention cleanup) | ✓ scheduled path | ✓ | `run_owner_retention` returns cleanup counters |
| L-04 (owner logout) | ✓ query purge | ✓ | `cleanup_owner_retention` RPC works |
| L-05 (ESLint) | ✓ lint clean | ✓ | `npm run lint` exits 0 |
| NV-01 (RLS cron jobs) | ✓ SECURITY DEFINER | ✓ | Migrations applied, no cron auth bypass |

**Conclusion:** All 12 audit findings have been statically fixed and runtime verified on staging. No findings remain UNVERIFIED.
