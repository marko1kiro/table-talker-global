# Ronde 7 Poin 2 — Desain

## Batasan

Kerja hanya pada `fix/point-2-manager-access-security` dari `9dbe9ce246cbdef89121339e0cc0f3556f84d4ba`. Semua migration `20260909010000`–`20260909080000` frozen. Perubahan SQL hanya migration forward-only baru setelah `09080000`. Tidak ada PR, merge, production deploy, atau remote migration.

## R7-A+C — Handoff dan exactly-once

Pending manager session menyimpan reservation ID immutable dan wajib non-null. Mint mengikat satu reservation ke satu pending token. Confirm memvalidasi pasangan token+reservation; pasangan berbeda fail-closed tanpa consume atau activation.

Handoff client mempertahankan token dan reservation pada logical attempt. Confirm retry terbatas memakai pasangan sama. Transport loss diikuti authoritative reconcile/CAS, bukan false failure. Storage, identity writer, navigation, confirm, cleanup, concurrency, duplicate retry, refresh, back, dan resubmit diuji sebagai behavior nyata. Cleanup failure tetap terlihat dan tidak ditelan.

## R7-B — Revocation fail-closed

Mandatory role switch hanya menerima `REVOKED` atau authoritative `ALREADY_INACTIVE`. `UNKNOWN_TOKEN`, malformed, timeout, RPC failure, dan `KIND_MISMATCH` menghentikan switch. Mandatory path tidak menggunakan `tolerateUnknown`.

Lifecycle revocation mencatat tombstone hashed/audit evidence untuk single, bulk, password/reset, deactivation, newest-wins, dan cutover. Lookup wrong-kind mencakup live row serta tombstone namespace lain.

## R7-D+E — Evidence nyata

Tambahkan actual HTTP dan Playwright/Chromium suites memakai production guards yang sama. Recovery diuji untuk valid, missing, duplicate, malformed, expired, used, refresh/back/resubmit, provider failure, dan token leakage. AM diuji untuk stale cookie, password/reset, deactivation, mismatch, expired/malformed token, direct route/action, dan invalid dashboard state.

PostgREST v16.2 digest-pinned/full-chain suite diperluas dengan reservation binding, parallel same-attempt reserve, wrong reservation, forged payload, cross-tenant, pending, revoked, dan wrong-kind. Disposable PostgreSQL/PostgREST dijalankan dengan konfigurasi CI resmi; local non-root wrapper diperbaiki bila perlu. Realtime dilaporkan `BLOCKED/NOT EXECUTED` bila official stack tidak tersedia; tidak ada klaim PASS.

Vercel evidence mencatat deployment ID, exact full SHA, branch, READY state, Preview/non-production target, `npm ci`, dan `npm run build`, tanpa token/cookie/secret.

## Delivery

Setiap grup risiko memakai strict RED test-only commit yang gagal pada baseline lalu GREEN implementation commit. Final gate: `npm ci`, `npm run verify`, actual browser suite, disposable DB/concurrency, PostgREST suite, diff checks terhadap baseline dan `origin/main`, secret scan, exact-SHA CI, Vercel metadata, serta Supabase read-only recheck.
