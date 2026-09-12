# Desain Poin 3 — Login Crew Berbasis Akun Email + Pairing Resto via OTP Manager

**Tanggal:** 13 September 2026
**Status:** MENUNGGU REVIEW PEMILIK
**Pemilik keputusan:** Marko (XDIRGA LABS)
**Roadmap:** MASTER-ROADMAP.md poin 3 (Blocker) — menyerap sebagian besar Poin 5.
**Supersedes:** aturan "crew tanpa akun personal" dari keputusan Poin 2 (2026-09) — diganti pemilik pada 13 Sep 2026 karena temuan: satu-satunya carrier JWT untuk klaim sesi & realtime adalah provider Anonymous yang kini MATI permanen di production, sehingga perangkat baru tidak bisa login sama sekali.

---

## 1. Masalah

1. Jalur login crew saat ini: Kode Resto → PIN → nama → `claim_role_session`. RPC itu sengaja di-grant HANYA ke role DB `authenticated` (pemisahan kewenangan dari hardening C-01: service-role tidak boleh menerbitkan sesi crew), sehingga browser WAJIB punya JWT user Supabase.
2. Carrier JWT itu diambil dari `signInAnonymously()` (provider Anonymous). Provider ini MATI di project production `kjzxtmxdbcanvkgqqdow` (bukti: `POST /auth/v1/token?grant_type=anonymous` → `unsupported_grant_type`). Perangkat lama bertahan via refresh token tersimpan; perangkat baru mutlak gagal.
3. Bug yang sama menimpa halaman Manager/AM di browser baru (realtime binding juga butuh carrier `authenticated`).
4. Flag `anonymous_signup_enabled` (migration `20260907210000`) tidak pernah dibaca client — dead code, dua sumber kebenaran.

## 2. Keputusan desain (disetujui pemilik 13 Sep 2026)

| # | Keputusan |
|---|---|
| D1 | Crew menjadi **user Supabase asli** dengan **email + OTP 6 digit**. Provider Anonymous **tetap OFF selamanya** untuk semua orang. |
| D2 | Pairing/anchor identitas = **EMAIL**, bukan perangkat. Manager OTP 6 digit **sekali seumur akun**: mematenkan pasangan email↔resto dan mencegah lintas resto. |
| D3 | **1 email = 1 perangkat aktif.** Login di perangkat baru menendang perangkat lama (role session dicabut + device pin dirotasi). |
| D4 | **Role tidak permanen** — crew lama/baru bebas pilih role (SS/Satgas/Kasir/Clear Up) setiap check-in, seperti model sesi saat ini. |
| D5 | Manager boleh **reset akun crew** (cabut pairing + sesi). Email yang sudah direset **boleh didaftarkan ulang** (OTP Manager baru diperlukan). |
| D6 | **Hard cutover**: alur lama (nama + tenant token + PIN tanpa akun) dihapus; semua perangkat crew re-register. |
| D7 | Manager & AM memperoleh carrier JWT via **akun bayangan (shadow user)** yang dibuat server on-demand saat login mereka lolos verifikasi kredensial sendiri. Password manager TETAP diverifikasi sistem kita (alur Poin 2 utuh). |

## 3. Arsitektur

### 3.1 Konfigurasi Supabase (dashboard, dicatat di runbook)
- Providers: **Email ON** (mode OTP; "Confirm email" on), **Anonymous OFF**, Phone OFF, OAuth tidak ada. Sign-up dengan password: dimatikan bila tersedia (flow OTP tetap harus bisa membuat user baru — diverifikasi saat implementasi; bila tidak bisa, user dibuat via verify OTP pertama, bukan `/signup`).
- **SMTP** GoTrue diarahkan ke Resend (`smtp.resend.com:465`, API key yang sama dengan `RESEND_API_KEY` Vercel), sender `noreply@lihatmeja.com`. Template email OTP berbahasa Indonesia, tanpa magic link.
- Session: `refresh token rotation` ON (default), TTL tetap bawaan; persistensi browser pindah dari **sessionStorage → localStorage** agar sesi bertahan tutup-tab/restart tablet (kebutuhan D3 "perangkat lama" vs "hapus data").

### 3.2 Alur Crew (halaman CREW)
State machine sisi client (komponen baru `CrewLoginFlow`, menggantikan `RoleLoginFlow`):
1. `bootstrap` — ada sesi auth valid + `crew_accounts.status='aktif'` di perangkat ini? → `checkin`. Tidak? → `identify`.
2. `identify` — input **email** → `auth.requestOtp({type:'email_otp'})` → layar input kode 6 digit → `auth.verifyOtp`. Respons error selalu generik (anti-enumeration).
3. Cabang hasil verify (server fn `crewAfterEmailOtp`, JWT user):
   - email **belum punya pairing** → `resto` : input **Nama + Kode Resto** → server fn `crewValidateCode` (service role) cek kode aktif → UI tampilkan **nama resto + ceklis hijau** → tombol **LANJUTKAN** → `pairing` : server fn `crewRequestPairing` membuat `crew_pairing_requests` (OTP 6 digit acak, hash tersimpan, `expires_at = now()+15 min`, satu pending per uid) → layar tunggu "Hubungi Manager".
   - email **sudah punya pairing aktif** → `checkin` (device pin dirotasi → perangkat lama ditendang, lihat §5.3).
4. `pairing` — crew input OTP dari layar dashboard Manager → **REGISTER DEVICE** → server fn `crewConfirmPairing` (JWT + otp): ≤5 percobaan, single-use, kadaluarsa → tulis pairing (`crew_accounts`: uid, restaurant_id, nama, status `aktif`) → `checkin`.
5. `checkin` — pilih **role** + **jam mulai kerja** (UI lama dipertahankan) → `claimCrewShift` (RPC baru; lihat §4.3) → masuk dashboard role; realtime & mutasi tetap pakai mekanisme `role_session_tokens` yang SUDAH ADA (tidak diubah).

### 3.3 Carrier JWT Manager/AM (halaman MANAGER)
- Login `/manager` tidak berubah dari sisi user: staff_id + password diverifikasi sistem kita (rate limit, tombstone lifecycle Poin 2 — utuh).
- Setelah lolos, server fn `ensureStaffCarrier`:
  - `manager_accounts.auth_user_id` NULL → admin API `createUser({ email, email_confirm: true, password: random(256bit) })`, `app_metadata={kind:'manager', account_id}`; simpan id. (AM sama: `area_manager_accounts.auth_user_id`.)
  - `generateLink({ type:'magiclink', email })` → token hash dikembalikan ke browser → `verifyOtp({ token_hash, type:'magiclink' })` → JWT carrier. Password GoTrue acak tidak pernah dipakai user.
  - Reset password manager (alur Poin 2) tidak menyentuh carrier; carrier expire sendiri, refresh ulang saat page load (`getLiveAccessToken` pola lama, kini ke user nyata).
- Super Admin console: TIDAK memakai carrier (semua akses via server fn service-role) — diverifikasi lewat audit §6; bila ketemu pemakai JWT, perlakukan sama seperti manager.

### 3.4 Dashboard Manager — kartu "Permintaan Crew"
- Card baru: daftar `crew_pairing_requests` pending untuk **resto milik manager yang login** (server fn + role session token manager).
- Tiap baris: email crew + nama + **OTP 6 digit besar** + countdown expiry + tombol **Tolak**.
- Auto-refresh realtime (kanal privat manager yang sudah ada).
- Card daftar crew: lihat anggota aktif, **Nonaktifkan** (= reset D5), force-logout sesi aktif per role session (mekanisme revoke Poin 2 dipakai ulang).

## 4. Model data (migration baru, semua RLS on + revoke publik; akses via service role / RPC `authenticated`)

### 4.1 `crew_accounts`
```
auth_uid        uuid primary key         -- = auth.users.id, anchor identitas
restaurant_id   uuid not null fk restaurants
email         citext not null unique
full_name       text not null
status          text not null default 'aktif'  -- aktif|nonaktif
device_hash     text                      -- sha256 device token aktif; NULL bila tidak ada perangkat
paired_by       uuid                      -- manager accounts id yang approve OTP
paired_at       timestamptz
created_at/updated_at
```

### 4.2 `crew_pairing_requests`
```
id, auth_uid fk, email, full_name, restaurant_id fk,
otp_hash text not null, attempts int default 0,
status: pending|approved|rejected|expired,
created_by_uid, expires_at, decided_by (manager), decided_at
unique partial (auth_uid) where status='pending'
```

### 4.3 RPC kunci
- `crew_validate_code(p_code text)` (authenticated, post-OTP; service juga untuk step pra-login? tidak — panggil dengan JWT): kembalikan `{restaurant_id, display_name}`; kode salah/inaktif → error generik. **Kode tetap rahasia lintas resto**, nama resto boleh tampak setelah benar.
- `crew_request_pairing(p_restaurant_id)`: uid = `auth.uid()`; harus belum punya pairing aktif; buat request pending OTP (OTP dikirim hanya ke dashboard manager, bukan ke email).
- `crew_confirm_pairing(p_request_id, p_otp)`: hash & bandingkan; attempts++; >5 → reject permanen request itu; sukses → upsert `crew_accounts` status aktif + audit log.
- `crew_claim_shift(p_role, p_checked_in_at, p_device_token)`: **restaurant_id TIDAK diambil dari argumen** — dibaca dari `crew_accounts` milik `auth.uid()` (gate lintas resto final). Validasi status aktif + `p_device_token` hash == `crew_accounts.device_hash`. Terbitkan `role_session_tokens` seperti claim lama.
- `crew_login_existing(p_device_token)`: rotasi `device_hash` ke perangkat ini + revoke role sessions perangkat sebelumnya.
- `manager_*`: `list_crew_pairing_requests`, `decide_crew_pairing_request`, `list_crew_accounts`, `reset_crew_account` — semua tervalidasi role session token manager + scope resto (pola RPC manager Poin 2).

### 4.4 Tabel lama yang disentuh
- `role_sessions`: tambah kolom `auth_uid uuid null` (jejak identitas; row historis tetap null — hard cutover tidak menghapus data, hanya menghentikan sesi: `update role_sessions set status='ended' ... where status='active'` saat migrasi).
- `20260907210000` remnants: `drop function is_anonymous_signup_enabled / set_anonymous_signup_enabled; drop table system_config` (dead code; satu sumber kebenaran = config GoTrue).
- `claim_role_session` lama + `verify_restaurant_pin` path crew: **drop/revoke** di migration cutover (fungsi tetap dipakai? tidak ada konsumen lain — diverifikasi saat implementasi).
- `restaurants.pin_hash`: jadi dorman (tidak dipakai login crew lagi). Keputusan rotasi/hapus = materi Poin 9.

## 5. Invarian keamanan

1. Provider Anonymous OFF; tidak ada jalur yang memanggil `signInAnonymously` (grep gate di CI test).
2. Sesi crew shift TIDAK PERNAH diterbitkan tanpa (email terverifikasi OTP) ∧ (pairing aktif) ∧ (device match).
3. `restaurant_id` untuk klaim sesi selalu server-derived dari pairing; input klien tidak dipercaya (cross-tenant gate, sebagian Poin 5 selesai di sini).
4. Manager OTP: 6 digit CSPRNG, tersimpan hash, single-use, kadaluarsa 15 menit, maks 5 percobaan, satu pending per email, tidak pernah dikirim via email/HTTP selain ke dashboard resto tujuan.
5. OTP email: mekanisme GoTrue standar + rate limit bawaan; template email tidak memuat data resto.
6. Enumerasi: respons request OTP email selalu identik; pesan error UI generik.
7. Reset crew oleh manager: revoke semua role sessions + nonaktifkan pairing; email boleh pairing ulang (uid yang sama — data historis tetap tertaut uid, nama bisa diganti saat pairing baru).
8. Device kick (D3): rotasi `device_hash` membuat JWT perangkat lama tetap hidup (refresh GoTrue) tetapi SEMUA RPC otoritatif crew menolak device token lama → perangkat lama diarahkan ulang ke layar "Akun login di perangkat lain".
9. Service-role key hanya di server (Vercel env); client tidak pernah menerima hash/OTP pairing via response selain layar manager.
10. Realtime: kanal privat + `bind_role_session_realtime` tidak berubah; JWT kini user asli — tidak ada policy RLS baru yang membaca metadata JWT (otoritas tetap session token).

## 6. Audit carrier (wajib sebelum deploy)
Daftar semua call-site `ensureAnonAccessToken`/`getSupabaseBrowserClient`/RPC `to authenticated` dan petakan ke §3.2/§3.3. Hasil jadi evidence doc. Termasuk: cek Super Admin console, halaman QR/ESB publik (anon key read-only, tidak butuh JWT — dicek), dan `loginToRestaurant` lama (dihapus/diganti).

## 7. Penanganan error UI (spesifik)
- `unsupported_grant_type` / provider mati → pesan: "Sistem login sedang dimatikan. Hubungi Manager." (harus tidak mungkin terjadi; tetap ditangani).
- OTP email salah/kedaluwarsa → "Kode tidak sesuai atau kedaluwarsa. Minta kode baru."
- Pairing expired/tolak → layar "Permintaan ditolak/kedaluwarsa — mulai ulang" + tombol ulang.
- Device ditendang → "Akun ini dipakai login di perangkat lain."
- Jaringan gagal saat claim → retry 1x, lalu pesan UNAVAILABLE generik.

## 8. Pengujian
- **DB (vitest + harness PG lokal)**: lifecycle pairing (request→approve→claim), OTP attempts habis, expiry, lintas resto ditolak (uid terikat resto A; klaim manual mustahil karena server-derived), device kick, reset-then-repair, cutover (claim lama 404/denied), kolom baru `role_sessions.auth_uid`.
- **Server fn (mock rpc)**: `ensureStaffCarrier` idempotent; mapping error codes.
- **UI (jsdom)**: state machine CrewLoginFlow per transisi §3.2 (termasuk ceklis hijau setelah kode valid), tombol 2 jalur homepage.
- **CI**: `npm run verify` + db-reset migration chain hijau.
- **Runbook manual** (smoke lapangan): perangkat baru → register penuh → pilih role; kedua kalinya buka tab baru → langsung checkin; ganti tablet → email+OTP → langsung checkin (tanpa manager); reset manager → daftar ulang.

## 9. Rollout & cutover
1. Merge PR (setelah review) → **jangan deploy dulu**.
2. Jalankan migration baru ke production via prosedur upgrade (backup → restore-check → apply) — persis playbook Poin 2.
3. Set GoTrue config di dashboard (providers + SMTP + template + persistensi) — runbook dengan langkah eksak.
4. Deploy app (hard cutover). Semua sesi crew lama di-revoke; crew lama re-register sekali.
5. Update `MASTER-ROADMAP.md` (Poin 3 DONE; Poin 5 menyusut — lihat §10) + evidence doc.
6. Rollback plan = restore backup + deploy build lama (dokumentasikan; kemungkinan dipakai kecil karena pilot).

## 10. Efek ke Poin 5 (roadmap akan diupdate)
Poin 5 sebelumnya = "pairing perangkat via OTP manager". Dengan D2, inti itu **selesai di Poin 3** (lebih kuat: anchor email, bukan device-id browser). Sisa Poin 5: force-logout per perangkat granular & pemblokiran perangkat, approval perangkat untuk jalur non-crew (jika masih ada), plus item 5 roadmap lain (device↔restaurant single binding, dsb.) yang tetap perlu dicocokkan dengan model baru ini.

## 11. Out of scope (disepakati)
- Rotasi/penghapusan `restaurants.pin_hash` (Poin 9).
- Perubahan hierarki Super Admin/AM/Manager Poin 2.
- Offline audio (Poin 7), telemetry SS (Poin 10), QR idempotency (Poin 8).
- UI multi-bahasa, rate limit dashboard.

## 12. Risiko terbuka (diselesaikan saat plan/implementasi)
1. **GoTrue signup-disabled vs OTP-create-user**: perlu spike kecil — pastikan `POST /otp` tetap bisa membuat user baru saat password-signup off; kalau tidak, biarkan signup on tapi tanpa form password (kita tidak pernah panggil `/signup`; audit call-site).
2. **`generateLink` magiclink exchange** untuk carrier manager: verifikasi pola `verifyOtp({token_hash,type:'magiclink'})` pada versi supabase-js terpasang; fallback: admin create user dengan password known-server lalu `loginWithPassword` server→token ke browser (hindari kalau bisa — token lewat response server fn).
3. **Resend SMTP untuk GoTrue**: domain lihatmeja.com sudah verified (dipakai feature email Poin 2) — tinggal aktivasi SMTP credential.
4. **Ukuran auth.users** membengkak oleh OTP-request spam → rate limit GoTrue + cleanup berkala; monitor advisory Supabase.
5. **Persistensi localStorage di tablet shared**: tab yang sama antar crew bergantian → setelah check-in, logout harus membersihkan sesi auth? Keputusan: role session logout TIDAK menghapus login email (sekali login = perangkat login); crew pinjam-meminjam = satu akun yang bergerak sesuai D3. Sesuai intent pemilik.
