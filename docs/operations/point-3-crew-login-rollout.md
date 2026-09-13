# Runbook — Rollout Poin 3 (Login Crew Akun Email + Pairing OTP Manager)

**Spec:** `docs/superpowers/specs/2026-09-13-poin-3-crew-account-login-design.md`
**Plan:** `docs/superpowers/plans/2026-09-13-poin-3-crew-account-login.md`
**Project:** Supabase `kjzxtmxdbcanvkgqqdow` · App pilot `https://qris-order.lihatmeja.com` (Vercel `gacoan1/lihat-meja`; alias `https://lihatmeja.com` menunjuk deployment yang sama — pakai host pilot di bawah untuk konsistensi)
**Model perubahan:** HARD CUTOVER — semua perangkat crew login ulang sekali setelah deploy.

## 0. Prasyarat (cek dulu, jangan skip)
- [ ] `npm run verify` hijau di branch ini (Task 12).
- [ ] Env Production Vercel sudah berisi: `QR_EXPORT_ENCRYPTION_KEY` (dipakai envelope OTP pairing — sudah ada sejak fitur QR export), `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Tanpa `QR_EXPORT_ENCRYPTION_KEY`, `crewPairingList` selalu UNAVAILABLE (fail-closed).
- [ ] Domain `lihatmeja.com` verified di Resend (sudah, dipakai Poin 2).
- [ ] Backup DB playbook Poin 2 siap dipakai (pg_dump via Session Pooler + enkripsi; lihat `docs/operations/evidence/production-point-2-upgrade-2026-09-12.md` bagian prosedur).

## 1. Konfigurasi Supabase Auth (Dashboard → Authentication)
Provider & policies:
- [ ] **Sign In / Up → Providers → Email: ON.** "Confirm email": **ON**. (OTP email = mekanisme konfirmasi.)
- [ ] **Anonymous sign-ins: OFF** (kondisi sekarang sudah OFF — JANGAN dinyalakan; CI test `point-3-anon-guard` gagal kalau muncul pemakaian di kode).
- [ ] Phone / OAuth lain: **OFF**.
- [ ] **Enable signups: TETAP ON.** (Spike §12: mematikan ini ikut memblokir pembuatan user via OTP. `/signup` password tidak pernah dipanggil app; tidak ada form password di UI. Monitor user sampah bila kena rate limit.)
- [ ] **SMTP** (Authentication → Emails → SMTP settings): Host `smtp.resend.com`, Port `465`, User `resend`, Password = nilai `RESEND_API_KEY`, Sender email `noreply@lihatmeja.com`. Save + **Send test email** ke alamat sendiri.
- [ ] Template **Verify OTP** / Confirmation (Authentication → Emails): subject `Kode login LIME`, body ID-only + 6 digit `{{ .Token }}`, HAPUS tombol magic link (`{{ .ConfirmationURL }}`) supaya OTP-only.
- [ ] Rate limits (Authentication → Rate Limits): "Enter code" min 60s; Email OTP per jam sesuai default pilot; catat nilai akhir di evidence.
- [ ] Session: biarkan TTL bawaan (access 1h; refresh rotation ON).

## 2. Apply migration (urutan EKSAK, sebelum deploy app)
File baru di `supabase/migrations/`:
1. `20260913100000_crew_account_schema.sql`
2. `20260913110000_crew_pairing_rpcs.sql`
3. `20260913120000_crew_shift_claim.sql`
4. `20260913130000_crew_legacy_cutover.sql`  ← **DESTRUCTIVE**: `delete from public.role_session_tokens;` (matikan semua sesi crew aktif) + drop `claim_role_session`.

Prosedur = playbook Poin 2:
- [ ] Backup penuh (pg_dump) + verifikasi restore-check lokal (DB `restore_check` port 5499).
- [ ] Simpan SHA-256 backup.
- [ ] Apply per file `psql --single-transaction` via Session Pooler (`aws-0-ap-southeast-1.pooler.supabase.com:5432`, user `postgres.kjzxtmxdbcanvkgqqdow`, netrc `.pgpass`).
- [ ] Per file sukses: `supabase migration repair --status applied <versi>` (CLI supabase@2.117.0, `--workdir repo`).
- [ ] Preflight: `select count(*) from role_session_tokens;` (catat), `select count(*) from crew_accounts;` (harus 0), `select count(*) from auth.users;` (catat baseline).
- [ ] Postflight: keempat obyek ada; `select count(*) from role_session_tokens` = 0; `claim_role_session` hilang dari `pg_proc`.

## 3. Deploy
- [ ] Merge PR → Vercel production build (alias `https://qris-order.lihatmeja.com`, sama-sama menunjuk deployment ini sebagai `https://lihatmeja.com`).
- [ ] Sentinel cutover client (`table-talker.poin3-cutover` di localStorage, konstanta `POIN3_CUTOVER_KEY`) otomatis membersihkan identitas sessionStorage lawas sekali per tab — tidak ada langkah server.

## 4. Smoke test lapangan (urutan)
1. **Perangkat crew baru (browser bersih):** buka `https://qris-order.lihatmeja.com/` — seluruh halaman pre-login MEMANG alur crew (tidak ada tombol CREW); tautan **"Login Manager"** ada di pojok kanan atas. → email → terima OTP 6 digit via email (≤60 detik) → verify → layar Nama + Kode Resto → kode benar → ceklis hijau + nama resto → LANJUTKAN → layar tunggu.
2. **Manager:** login `/manager/login` (di browser yang belum pernah: harus lancar — carrier bayangan dibuat saat login) → tab Crew → kartu **Permintaan Crew** menampilkan email+OTP besar.
3. Crew input OTP → **REGISTER DEVICE** → pilih role → masuk dashboard role → audio/soundboard SS / status meja real-time berfungsi (cek 1 event).
4. **Device kedua email sama:** ulangi login email di browser lain → HP pertama: operasi berikutnya gagal sesi (kick) → layar "perangkat lain" muncul saat buka ulang → cek **"Keluar akun"** di layar itu: harus kembali ke langkah email kosong (tidak ada sapaan nama crew lama). Cek juga affordance "Bukan <nama>? Keluar" di layar pilih station.
5. **Reset:** Manager → kartu Akun Crew → Reset (double-tap) → crew tsb tidak bisa klaim shift (ACCOUNT_DISABLED); daftar ulang → OTP Manager baru → aktif lagi.
6. **Anti-lintas-resto:** crew ter-pair Resto A coba kode Resto B saat register → ALREADY_PAIRED, tetap Resto A.
7. Pairing kadaluarsa (15 mnt) → layar restart "Minta kode baru" works.
8. Manager reject request → crew melihat layar ditolak.

## 5. Rollback (hanya kalau darurat)
1. Restore DB dari backup step 2 (playbook Poin 2) — sekaligus mengaktifkan kembali `claim_role_session`.
2. Redeploy build production sebelumnya (`vercel redeploy <deployment-id>` — catat id sebelum deploy step 3).
3. Provider Anonymous TETAP OFF: alur crew lama akan GAGAL di perangkat baru (bug lama) — rollback = mengembalikan kondisi rusak-sementara, bukan solusi; gunakan hanya bila app baru corrupt-total.

## 6. Pasca-rollout (evidence)
- [ ] Tulis `docs/operations/evidence/production-point-3-crew-login-<tanggal>.md`: hasil smoke, timestamp apply per migration, pre/post counts (role_session_tokens, auth.users), nilai rate limit, SHA backup.
- [ ] Update `MASTER-ROADMAP.md`: Poin 3 status; Poin 5 menyusut (lihat §10 spec).
- [ ] Cek Supabase advisories (`supabase_get_advisors`) setelah schema baru.
