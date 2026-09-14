# Poin 6.1 — Login Password Crew + Update Prompt — Design

Tanggal: 2026-09-15 · Status: APPROVED lisan oleh pemilik (desain 3 seksi + addendum, chat 14–15 Sep) · Supersede sebagian: Poin 3 §3.2 (alur crew OTP-only)

## 0. Masalah (gejala lapangan trial CKRBUL)

1. Mekanisme daftar/login crew belum stabil. Gejala konkret dari pemilik:
   - OTP email nyampe, tapi setelah input kode + klik "Verifikasi", **kadang balik ke layar login** (loop) statt lanjut ke input nama + kode resto.
   - Crew yang nekat klik tautan magic di email **mentok di halaman login** (tidak ada route callback).
2. Bug UI pairing: input "kode dari Manager" memakai state OTP yang sama → **masih terisi kode email sebelumnya** → crew kira itu kodenya.
3. Klik berlebihan: setelah Lanjut pairing masih harus klik "Sudah punya kode? Masukkan" dulu.
4. Magic link/OTP sebagai metode login rutin = tidak efisien (mau pemilik: hapus, ganti password).

Akar gejala #1 di kode: SEMUA kegagalan transien pasca-verifikasi (`refreshCarrierToken` null, `crew_me` UNAVAILABLE/error apa pun) di-`setStep("email")` + buang seluruh state (`CrewLoginFlow.tsx:230-233,296-300`). WiFi kedip = crew balik titik nol.

## 1. Keputusan desain (ringkas)

- **Metode login rutin crew = email + password.** Magic link dihapus dari peredaran; email-OTP dipertahankan HANYA sebagai alat: (a) verifikasi identitas saat daftar, (b) setup password pertama crew lama, (c) pemulihan lupa password. OTP selalu disusul layar Buat Password — tidak ada login OTP yang langsung masuk dashboard.
- **Email-first otomatis (plan C)**: satu layar "Masukkan email"; server yang menentukan langkah berikutnya (password vs kode) — crew tidak disuruh memilih.
- **Pairing Manager tetap wajib** untuk crew baru; tidak berubah.
- **Set password browser-direct** via `auth.updateUser({ password })` saat sesi OTP hidup → nol sentuhan ke sesi perangkat lain (dikonfirmasi: `security_update_password_require_reauthentication=False`, `password_min_length=6`, `disable_signup=False` — GoTrue production, GET config 15 Sep).
- **Update Prompt wajib-konfirmasi** untuk SEMUA role (crew, AM, manager, super admin): modal "Ada Update sistem, Tolong refresh halaman ya." dengan tombol "Refresh" / "Nanti Aja".
- Mobile-first: 60% user pakai iOS/Safari. Semua kontrol wajib jalan di Android Chrome & iOS Safari.

## 2. State machine crew (pengganti alur lama)

```
email ──crewLoginMethod──┬─ mode=password → password ─signInWithPassword→ routeSession
                         │                        └─ "Lupa? kirim kode email" → otpSend → verifyOtp → setPassword → routeSession
                         └─ mode=otp      → otpSend → verifyOtp → setPassword → routeSession

routeSession (crewMe):
  unpaired               → resto (nama + kode resto) → waiting (input kode Manager langsung tampil, selalu kosong)
  paired + aktif + device kini → checkin (Pilih Station) → claim → dashboard
  device lain            → kicked        akun nonaktif → disabled
```

Aturan:

- `setPassword` = gate wajib di SEMUA jalur OTP. Dua kolom (password + konfirmasi), min 6 karakter, show/hide (lucide `Eye`/`EyeOff`), `autocomplete="new-password"`, `autoCorrect/autoCapitalize off`. Simpan → `updateUser`; gagal → retry in-place, sesi OTP tidak dibuang. Lanjut routing otomatis: crew baru → resto; crew lama → checkin.
- `password` screen: `autocomplete="current-password"` (Keychain iOS menawarkan simpan), Enter = submit. Salah → pesan netral "Email atau password salah." + link "Belum bisa masuk? Kirim kode email".
- `waiting`: form input kode Manager **langsung tampil** begitu request pairing sukses; state input dipisah (`otpEmail` ≠ `otpPairing`); field pairing WAJIB mulai kosong; HILANGKAN tombol "Sudah punya kode? Masukkan". Countdown 15 menit + "Minta kode baru" tetap.
- **Anti double-klik (permintaan pemilik):** setiap tombol submit disabled + spinner sejak klik pertama sampai respons tiba, di SEMUA step (termasuk password & setPassword); guard re-entrant `if (busy) return` di level fungsi juga tetap.
- Loop-login lama Diperbaiki: kegagalan transien (transport/`UNAVAILABLE`/`crewLoginMethod` jaringan mati) → alert + tombol "Coba lagi" IN-PLACE, sesi & input dipertahankan. `refreshCarrierToken()` null → 1x retry jeda ±1 dtk sebelum vonis `SESSION_LOST`. Kembali ke layar email HANYA saat sesi benar-benar mati (`UNAUTHORIZED`/`SESSION_LOST`).
- Kontrak `onSsContinue`/`onRoleContinue` TIDAK berubah → layar dashboard SS/kasir/satgas/clear_up tidak tersentuh.

## 3. Backend

### 3.1 RPC `crew_auth_method(p_email text)` (migration baru, additive)

- `SECURITY DEFINER` owned postgres; baca `auth.users` + `lookup_rate_limits`.
- Normalisasi email (trim + lowercase) di SQL; validasi format di server fn.
- Return SATU dari: `'password'` (user ada, `coalesce(encrypted_password,'') <> ''`) | `'otp'` (user tanpa password ATAU email tidak ada — enumeration tetap kabur).
- Throttle IP via `check_lookup_rate_limit(p_ip_hash)` existing (window 15 menit, pola 5 gagal). Meledak → status `THROTTLED`; fail-closed.
- `EXECUTE` HANYA `service_role`. Tidak ada grant anon/authenticated.

### 3.2 Server function `crewLoginMethod(email)` (TanStack Start, pola `crewValidateCode`)

- Terima email mentah → validasi zod → reserve limiter (IP di-hash server-side, browser tidak pernah kirim IP mentah) → `rpc crew_auth_method` → lepas reservasi → return `{ method: "password" | "otp" }` atau `{ throttled: true }`.
- Satu-satunya endpoint anonim baru; sisanya butuh sesi JWT.

### 3.3 Yang TIDAK berubah

- `crew_me`, `crew_shift_claim`, `crew_validate_code`, `crew_request_pairing`, `crew_confirm_pairing`, `role_session_tokens`, device-pin: utuh.
- GoTrue config: tidak ada patch (termasuk jwt_exp tetap 28800 dari T3).
- Template email OTP custom LIME: sudah murni 6-digit tanpa `{{ .ConfirmationURL }}` — dibiarkan; magic link tidak pernah punya route handler, dan setelah Poin 6.1 OTP hanya dikirim untuk setup/reset.
- Aset AGENTS §2: nol drop/alter destruktif. Migration hanya CREATE FUNCTION/TABLE.

## 4. UI/UX polish (standar pemilik: loading state, skeleton, animasi ringan, toast informatif)

- Mount `<Toaster />` (sonner — sudah dependency, komponen `src/components/ui/sonner.tsx` sudah ada tapi belum pernah dipasang) di root client entry, posisi atas, responsive.
- Toast sukses informatif: "Password tersimpan", "Kode dikirim ke email", "Berhasil masuk". Error tetap inline `Alert` (pola field-level lama) — tidak pakai dialog untuk error form.
- Step `boot`: spinner telanjang → skeleton kartu AuthLayout (pakai `src/components/ui/skeleton.tsx` existing).
- Transisi antar step: fade ±150 ms pakai class Tailwind existing (tanpa lib animasi baru — YAGNI).
- Mobile: `svh/dvh`, safe-area tidak rusak (AuthLayout existing), `inputMode="numeric"` untuk OTP.

## 5. Update Prompt (semua role)

1. Build ID: `vite define` → `__APP_BUILD_ID__` = `process.env.VERCEL_DEPLOYMENT_ID` saat build CI (fallback: `'dev'` lokal, jangan pernah tampil prompt saat dev).
2. `version.json` di `public/` — `{ "build": "<VERCEL_DEPLOYMENT_ID>" }`; dibuat otomatis oleh build script yang sama (satu sumber kebenaran, bukan file manual).
3. Modul tunggal `src/lib/update-prompt.ts`, dipasang di root shell semua role:
   - Cek pada: app start, tiap 5 menit, dan `visibilitychange → visible`. Fetch `version.json?t=<now>` dengan `cache:"no-store"`.
   - `data.build !== __APP_BUILD_ID__` (dan keduanya bukan `'dev'`) → buka modal.
   - Gagal fetch (offline/WiFi kedip) → diem total.
4. Modal: overlay `fixed inset-0 z-[100] bg-black/50`, kartu ter-center `dvh`, teks PERSIS: **"Ada Update sistem, Tolong refresh halaman ya."** Dua tombol:
   - **"Refresh"** → `location.reload()`.
   - **"Nanti Aja"** → tutup; tidak muncul lagi di halaman itu; flag `sessionStorage` per-tab (`lm.update.dismissed.<build>`) → prompt bisa muncul lagi di page-load/sesi berikutnya dengan build baru. Tidak ada auto-refresh diam-diam kapan pun.
5. Trigger kedua: error "failed to fetch dynamically imported module" (chunk hash lenyap pasca-deploy — sumber insiden 14 Sep) → tampilkan modal yang sama.
6. Modal wajib-konfirmasi (tanpa ESC-dismiss diam-diam; klik overlay tidak menutup).

Tradeoff sadar: crew yang lagi input panjang bisa kehilangan draft saat memilih Refresh — keputusan ada di tangan crew, itu maunya pemilik (konfirmasi wajib).

## 6. Keamanan sesi aktif (note trial lapangan)

- Urutan rilis: **apply migration (additive) SEBELUM merge deploy** — kode baru memanggil RPC baru.
- `updateUser({password})` tidak menyentuh sesi perangkat lain; sesi login saat ini dipertahankan GoTrue.
- Tidak ada invalidasi token, tidak ada perubahan nama kolom/role session, tidak ada perubahan realtime binding.
- Jendela deploy tetap berisiko tab lama (preseden diterima §5 Poin 6) → deploy jam sepi + Update Prompt justru jadi mitigasi baru.
- Crew lama yang belum sempat set password tetap bisa masuk lewat jalur OTP → diarahkan bikin password (bukan dikunci).

## 7. Testing (TDD; mesin transisi diuji murni)

- `src/lib/crew-login-machine.ts` (baru): reducer murni `(step, event) → step + effect` untuk P1 di atas. `tests/crew-login-machine.test.ts` — semua jalur: mode=password/otp, lupa-password, wajib setPassword, retry in-place vs buangan sesi, guard busy.
- Komponen (perluas `tests/point-3-crew-login-flow.test.tsx` + `tests/crew-login-code.test.ts` yang sudah ada): field pairing mulai kosong meski otpEmail terisi; tidak ada tombol "Sudah punya kode"; submit disable saat busy; Enter submit.
- Server fn `crewLoginMethod`: mock rpc — throttle, fail-closed, normalisasi email, dua nilai method.
- `tests/db/point-6-1-crew-password.test.ts`: `crew_auth_method` ada, SECURITY DEFINER, grant hanya service_role, verdict password/otp benar; nol objek yang di-drop (post-check aset).
- Guard build: `version.json` ter-generate dengan placeholder dev; `Toaster` ter-mount; tidak ada route `/auth/callback` magic link.

## 8. Rollout & bukti

1. Migration additive → `tests/db` hijau lokal (embedded pg) → PR → CI `verify` + `db-reset` → squash `main`.
2. Apply migration ke production via prosedur evidence (pre/post count aset §2 AGENTS; tidak ada drop).
3. Deploy production (jam sepi) → Update Prompt aktif → evidence doc baru `production-point-6-1-crew-password-2026-09-15.md` (build ID, run CI, langkah uji).
4. Field test pemilik: crew lama (OTP→set password→checkin), crew baru (OTP→set password→resto→pairing→approve→checkin), lupa password, prompt update muncul setelah deploy berikutnya, tombol refresh berfungsi di iOS Safari + Android.

## 9. Out of scope

- Login manager/AM/SA (sudah password; tidak disentuh kecuali pemasangan Update Prompt di shell-nya).
- Layar dashboard/realtime (Poin 6 menutupnya).
- Self-service ubah password di dalam app (bukan lewat alur lupa) — kandidat Poin berikutnya kalau diminta.
