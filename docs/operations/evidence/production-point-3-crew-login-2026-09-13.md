# Production Point 3 Rollout — Evidence (2026-09-13)

**Scope:** Poin 3 hard cutover — crew login pindah ke akun email OTP + pairing resto diverifikasi Manager lewat OTP 6-digit. Manager/AM pindah ke carrier shadow-user internal (provider Anonymous OFF permanen).
**Project:** Supabase `kjzxtmxdbcanvkgqqdow` · Vercel `gacoan1/lihat-meja` · alias `https://lihatmeja.com` (+ `https://qris-order.lihatmeja.com`).
**Runbook:** `docs/operations/point-3-crew-login-rollout.md` §0–§6. Spec: `docs/superpowers/specs/2026-09-13-poin-3-crew-account-login-design.md`.
All timestamps UTC unless noted. Exact per-file migration apply minutes were not journalled (window 10:45–11:15); every other stamp below is machine-verified from CI runs / DB rows.

## 1. GoTrue configuration (Management API PATCH)

- Providers: Email **ON** + Confirm email ON; Phone OFF; **Anonymous OFF (ban permanen, CI-pinned)**; OAuth OFF. Signups ON (`disable_signup=false` — WAJIB, GoTrue menolak create-user via OTP kalau OFF).
- SMTP: `smtp.resend.com:465`, user `resend`, sender `noreply@lihatmeja.com` (domain Resend verified sejak Poin 2).
- OTP: length 6, expiry 3600 s. Template konfirmasi = subjek `Kode login LIME: {{ .Token }}`, body token 6 digit, TANPA ConfirmationURL link. Site URL `https://lihatmeja.com`.
- Rate limits awal: email-sent **2/menit (per IP)** — terbukti salah, lihat §7; verify 30, otp 30. Captcha OFF.
- Email test PASS 13 Sep ~10:3x: `POST /auth/v1/otp` → `support@lihatmeja.com` menerima kode 6 digit ≤60 detik, tanpa link.

## 2. Backup + restore-check (sebelum apply)

- `pg_dump` via Session Pooler (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.kjzxtmxdbcanvkgqqdow`, netrc `.pgpass`) ± 20 s, ~1,4 MB.
- Restore-check lokal: DB `restore_check` port 5499 — **PASS** (catatan: pakai `-h 127.0.0.1`, `localhost` kena jebakan IPv6).
- Enkripsi AES-256-GCM via pgcrypt: `C:\Users\dirga\Documents\LIME\backup\point3-pre-cutover-20260913.dump.enc`; plaintext dump dihapus setelah enkripsi.
- SHA-256 plaintext dump : `1C1406847970DCB06C99DD54CBA4D9ECBCB28D353905E15B3D2943AA81927A73`
- SHA-256 file .enc   : `1399CFBBB39F7C21AC592178FF9EA9ACD2EB0B065076059A317CBEE1522E48B9`
- Passphrase: `C:\Users\dirga\Documents\LIME\backup-passphrase.txt` (jangan sampai hilang; backup Poin 2 juga hidup).

## 3. Apply migration (urutan eksak, window 10:45–11:15)

`psql --single-transaction` per file via Session Pooler, lalu `supabase migration repair --status applied <versi>` (CLI 2.117.0):

1. `20260913100000_crew_account_schema.sql`
2. `20260913110000_crew_pairing_rpcs.sql`
3. `20260913120000_crew_shift_claim.sql`
4. `20260913130000_crew_legacy_cutover.sql` — DESTRUCTIVE: `delete from role_session_tokens` (19 token lama dibuang; tabel TETAP dipakai — `crew_shift_claim` me-reuse-nya sbg tabel token role 9 jam by design) + drop `claim_role_session`.

Preflight: `crew_accounts=0`, `auth.users=248`, `role_session_tokens=19`, restaurants=9.
Postflight (setelah 130000): `role_session_tokens=0`, `claim_role_session` hilang dari `pg_proc`, skema+RPC `crew_*` ada (5), `schema_migrations` latest = `20260913130000`.

## 4. App deploy

- PR #27 `feat/point-3-crew-account-login` → merge `dbaf2d7`; CI penuh (verify + db-reset replay 4 migration) sukses 10:21:20 (run 34751632210 / 34751632284).
- Vercel production Ready; HTTP 200 `/`, `/manager/login`, `/super-admin`.
- Sentinel cutover client (`table-talker.poin3-cutover`) aktif tanpa langkah server.

## 5. Bug pasca-deploy: login Manager mati (race boot-guard) — FIXED

- Gejala: Manager login → bounced balik ke `/manager/login`, semua payload server-fn `ok:true`.
- Root cause: guard mount `/manager` menghapus identity bila melihat record pending→active, padahal core handoff bernavigasi SEBELUM `confirmHandoff` resolve; carrier sign-in Poin 3 memanjangkan window sehingga race jadi deterministik (latent sejak Poin 2).
- Fix `src/lib/manager-boot-guard.ts` — grace window 12×400 ms HANYA saat bearer pending == bearer identity; record asing/tanpa identity/corpse tetap bounce; invarian P1-4 (recovery record tak pernah dimakan) utuh; 13 test baru/ubah.
- Commit `82ce273` langsung ke main; CI sukses 14:11:47 (2m5s penuh). Deploy Ready.
- Smoke produksi Playwright 14:19:24: login akun manager asli (ID 411173) → `/manager` render grid 100 meja + data live (Terisi 10). Carrier sign-in terekam `last_sign_in` DB.

## 6. Field smoke (runbook §4) — PASS oleh pemilik

- 14:39:45–14:40:51 — `miracle1min@gmail.com`: OTP kirim ≤60 dtk → verify → Kode Resto CKRBUL → Manager approve (OTP Manager 6-digit, sekali seumur akun) → `crew_accounts` **aktif** paired.
- 15:28–15:35 — `faridputra9987`, `bagasprastyo62`, `putriamira6520` buat akun via perangkat nyata; total 91 `crew_role_sessions` tercatat; device-kick (1 email = 1 perangkat), layar "perangkat lain"/"Keluar akun", Reset Manager → ACCOUNT_DISABLED → daftar ulang: **semua diuji pemilik di perangkat nyata, lulus** (laporan pemilik, 13 Sep).

## 7. Insiden ops: pesan "Sistem login sedang dimatikan" = 429, bukan outage

- ~14:30 pemilik melapor; repro REST: `POST /auth/v1/otp` → HTTP 429 `over_email_send_rate_limit` — limiter 2/menit **per IP** jebol oleh burst uji dari satu NAT kantor; UI memetakan SEMUA error OTP ke pesan provider-mati.
- Mitigasi live: `rate_limit_email_sent` 2 → **30**; probe 200 OK.
- Fix kode `8dd1f73` (CI sukses 16:39:25): `browser-auth.attempt()` klasifikasi 429/rate-limit → `RATE_LIMITED`; UI crew menampilkan "Terlalu sering meminta kode. Tunggu 1 menit, lalu coba lagi."; PROVIDER_DOWN eksklusif untuk kegagalan pre-verification sejati.
- Verifikasi LIVE produksi (repro insiden): limit turun sementara ke 2 → bucket diisi → submit OTP di UI → pesan "terlalu sering" tampil, BUKAN "dimatikan". Limit dipulihkan ke **30**. User probe `lime-probe+*` dihapus dari `auth.users`.

## 8. Revisi UI Manager (di luar runbook, owner request)

- `9046a86` (CI 15:58:43): menu **OTP CREW** khusus (di bawah LIHAT STATUS MEJA LIVE) — panel Permintaan Crew + Akun Crew pindah dari tab crew; header mobile: teks DASHBOARD → logo LIME (fix geser horizontal). Diverifikasi live viewport 390 px: `scrollW==clientW`, urutan nav & pindah panel benar.

## 9. Cleanup & state akhir

- Akun probe `zz.probe.mgr` (+sessions+carrier) dan semua `lime-probe+*` dihapus; `manager_accounts=6` (asli), `restaurants=9`.
- Counts saat evidence (17:0x): `auth.users=256`, `crew_accounts=4` (3 aktif + 1 hasil uji), `crew_pairing_requests=5` (riwayat), `crew_role_sessions=91`, `role_session_tokens=5` (semua token uji lapangan, expiry ≤9 jam).

## 10. Advisories (supabase_get_advisors security, 17:07)

- INFO `rls_enabled_no_policy` × 46 — **by design**: semua akses lewat RPC SECURITY DEFINER; tanpa policy = deny-by-default untuk anon/authenticated via REST.
- WARN `function_search_path_mutable` × 2 — `normalize_staff_id`, `staff_id_is_valid` (legacy Poin 2; follow-up, bukan blocker pilot).
- WARN SECURITY DEFINER executable — 30 via `authenticated` (by design, RPC bridge dgn validasi token internal); 1 via `anon`: `log_occupancy_transition` (trigger-fn legacy — ditinjau terpisah saat hardening).
- WARN leaked-password protection OFF — carrier pakai 64-hex rotating password (tidak terpengaruh); manager/SA pakai password statis → pertimbangkan ON pasca pilot.

## 11. Rollback posture

- DB: restore `point3-pre-cutover-20260913.dump.enc` (playbook Poin 2) → juga mengaktifkan kembali `claim_role_session`.
- App: `vercel redeploy` deployment pra-Poin 3; provider Anonymous TETAP OFF (rollback = kondisi lama-rusak, lihat runbook §5).

## 12. Verdict

Runbook §1–§6 terlampiri penuh: config ✔, migrations ✔, deploy ✔, field smoke §4 PASS (owner), evidence ✔, advisories ✔. Status Poin 3 di MASTER-ROADMAP dinaikkan ke **DONE — owner-approved 13 Sep 2026**; independent re-review TASKLET belum dilakukan (preseden sama dgn Poin 2).
