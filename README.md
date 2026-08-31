# Table Talker

Soundboard panggilan meja berbasis TanStack Start dan Vercel.

Seluruh audio (termasuk sound CKRBUL) disimpan di katalog per restoran pada
Cloudflare R2 — tidak ada lagi audio bawaan di dalam repository. Crew mengunduh
audio melalui endpoint aplikasi yang terautentikasi, memverifikasi ukuran dan
SHA-256, lalu menyimpannya di Cache Storage browser.

## Menjalankan lokal

```bash
npm install
cp .env.example .env
# isi nilainya, lalu:
npm run dev
```

### Kredensial

Setup dashboard awal hanya membutuhkan `AUTH_SECRET` dan `DASHBOARD_PASSWORD`.
Login restoran, katalog audio, sinkronisasi crew, dan Super Admin juga membutuhkan
konfigurasi Supabase dan Cloudflare R2 server-only.

| Variable                    | Dipakai untuk                                       |
| --------------------------- | --------------------------------------------------- |
| `DASHBOARD_PASSWORD`        | Password halaman dashboard `/`                      |
| `SUPER_ADMIN_PASSWORD`      | Password khusus halaman remote audio `/super-admin` |
| `AUTH_SECRET`               | Menandatangani cookie sesi, minimal 32 karakter     |
| `VITE_SUPABASE_URL`         | URL Supabase publik untuk browser crew              |
| `VITE_SUPABASE_ANON_KEY`    | Anon key Supabase publik untuk browser crew         |
| `SUPABASE_URL`              | URL Supabase untuk server Super Admin               |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key Supabase untuk server Super Admin  |
| `CF_ACCOUNT_ID`             | Account ID Cloudflare untuk akses R2                |
| `CF_R2_ACCESS_KEY_ID`       | Access key R2 server-only                           |
| `CF_R2_SECRET_ACCESS_KEY`   | Secret key R2 server-only                           |
| `CF_R2_BUCKET`              | Bucket R2; default `soundboard`                     |
| `CF_R2_PUBLIC_URL`          | Base URL metadata upload (bukan URL download crew)  |

`VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` memang publik karena dibundel ke
browser. `SUPABASE_URL` dan terutama `SUPABASE_SERVICE_ROLE_KEY` hanya untuk
runtime server: jangan beri awalan `VITE_`, jangan masukkan ke kode browser, dan
jangan commit nilainya.

Buat `AUTH_SECRET` dengan `openssl rand -hex 32`. Di production, server menolak
start kalau `AUTH_SECRET` kosong atau kurang dari 32 karakter.

> Jangan pernah menuliskan nilai kredensial di `README.md`, `.env.example`, atau
> di dalam kode. Simpan hanya di `.env` lokal (sudah di-gitignore) dan di
> environment variables Vercel.

## Struktur audio

Semua audio dikelola sepenuhnya lewat database (Supabase `audio_manifests`) dan
objek Cloudflare R2 — tidak ada file MP3 apa pun yang dibundel di dalam repo.
Audio ditambahkan/diganti melalui `/super-admin` (upload MP3 ke katalog restoran
yang dipilih), bukan dengan mengedit file di repository.

### Cara mengganti audio

1. Login ke `/super-admin` dengan `SUPER_ADMIN_PASSWORD`.
2. Pilih restoran, lalu unggah/ganti file MP3 pada Audio ID yang sesuai
   (`table:<nomor>` untuk sound meja, `announcement:<id>` untuk pengumuman).
3. Uploader menghitung SHA-256 dan menyimpan objek R2 dengan key immutable, lalu
   menyimpan mapping-nya ke `audio_manifests`.

Saat login, crew mengambil manifest lewat endpoint same-origin yang memvalidasi
tenant dan katalog aktif; browser kemudian memverifikasi hash dan ukuran sebelum
menyimpan cache.

Tombol pengumuman membaca keempat nama file di `announcements/` secara persis.
Kalau salah satu filenya tidak ada, tombolnya otomatis tampil non-aktif.

## Deploy ke Vercel

1. Import repository ke Vercel.
2. Tambahkan environment variables dasar yang wajib untuk dashboard/sesi:
   - `AUTH_SECRET`: string acak minimal 32 karakter.
   - `DASHBOARD_PASSWORD`
3. Deploy. Build command dan target server Vercel sudah dikonfigurasi.

Fitur remote hanya aktif bila lima variabel opsionalnya juga diisi:
`SUPER_ADMIN_PASSWORD`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_URL`, dan `SUPABASE_SERVICE_ROLE_KEY`. Tanpanya, remote dinonaktifkan
secara fail-open; dashboard dan soundboard tetap berfungsi dengan audio dari
katalog R2 restoran yang sudah disinkronkan.

Untuk sinkronisasi crew, konfigurasi Supabase dan kredensial Cloudflare R2
server-only pada deployment. Browser tidak mengakses hostname publik R2 secara langsung.

### Super Admin

> **⚠️ Catatan (2026-08-30):** subsistem remote-command/heartbeat yang
> dulunya dijelaskan di bagian ini (Super Admin mengirim perintah "putar
> audio dari jarak jauh" ke device crew tertentu, heartbeat foreground
> 10 detik, kelayakan device 30 detik, TTL perintah 5 detik) **telah
> dihapus sepenuhnya** sebagai bagian dari Major Update "Table Occupancy
> Tracking" (lihat
> `docs/superpowers/specs/2026-08-29-table-occupancy-tracking-design.md`
> bagian "Removal Scope" dan Task 1-4 di
> `docs/superpowers/plans/2026-08-29-table-occupancy-tracking.md`).
> Digantikan oleh pelacakan status meja (KOSONG/TERISI) berbasis QR
> Interceptor + role Kasir/Satgas/Clear Up. Paragraf lama di bawah ini
> **tidak lagi berlaku** dan disimpan sebagai riwayat saja sampai
> dokumentasi ini ditulis ulang penuh setelah Task 9-14 selesai.

`/super-admin` memakai `SUPER_ADMIN_PASSWORD` terpisah dari dashboard.
Fitur yang masih aktif saat ini: kelola katalog audio per restoran
(upload/ganti MP3), kelola kredensial "Kode Resto" (lihat/ganti kode),
riwayat pemutaran audio (`Riwayat`), log error operasional
(`Error Log`), dan (baru, 2026-08-30) panel ESB App ID + export link QR
per restoran (`src/routes/super-admin/esb-export.tsx`). Aplikasi tetap
fail-open: bila Supabase tidak dikonfigurasi, dashboard dan soundboard
normal tetap berjalan dengan audio dari katalog R2 restoran.

~~Crew memasukkan nama lalu menekan `LANJUT!!`. Gesture ini memutar sumber
audio bisu (silent) singkat dalam keadaan muted agar browser mengizinkan
pemutaran remote. Hanya crew audio-ready, tab terlihat, dan koneksi aktif
yang mengirim heartbeat foreground setiap 10 detik yang dapat dipilih;
kelayakannya berakhir setelah 30 detik tanpa heartbeat. Perintah berlaku 5
detik, diproses sekali tanpa replay saat duplikat, reconnect, tab
tersembunyi, atau perangkat kembali aktif. Audit perintah disimpan tujuh
hari.~~ *(dihapus di Task 1-4 Major Update — tidak lagi relevan)*

Android Chrome dan iOS Safari membatasi autoplay serta dapat menangguhkan tab,
layar terkunci, atau audio di latar belakang. Jangan menjanjikan pemutaran pada
kondisi tersebut: buka crew di foreground, tekan `LANJUT!!`, lalu gunakan pemulihan
`Aktifkan Suara` bila browser menolak audio. (Ini masih berlaku — terkait unlock
audio gesture SS, bukan bagian dari subsistem remote-command yang dihapus.)

#### Setup Supabase

1. Buat proyek Supabase, lalu aktifkan **Anonymous sign-ins** pada Authentication.
2. Isi lima variabel fitur remote di `.env` lokal serta environment variables
   Vercel: `SUPER_ADMIN_PASSWORD` dan empat variabel Supabase.
3. Gunakan Supabase CLI melalui `npx`; tidak perlu dan jangan menambah dependency
   CLI ke proyek ini. Fresh clone ini sudah memiliki `supabase/migrations/`, tetapi
   belum memiliki `supabase/config.toml`. Hanya bila file config belum ada, jalankan:

   ```bash
   npx supabase init
   ```

   Periksa config yang dibuat sebelum commit; `init` tidak diperlukan untuk tugas
   dokumentasi ini dan tidak boleh mengganti migration yang sudah ada.

4. Login, hubungkan proyek, lalu terapkan migrasi:

   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Ambil `YOUR_PROJECT_REF` dari Supabase Dashboard. Jangan commit access token CLI,
   password, atau nilai kredensial apa pun.

   Migrasi mengaktifkan RLS deny-by-default, memberi crew hanya akses session
   miliknya melalui RPC. ~~serta menambahkan `crew_sessions` dan
   `remote_commands` ke Realtime publication~~ *(`remote_commands` sudah
   dihapus di Task 1-4 Major Update, 2026-08-30; `crew_sessions` dipertahankan
   tapi dipersempit ke kolom identitas saja — lihat catatan di atas)*. Jangan
   membuat policy tabel longgar atau memberi service-role key ke client.

~~`pg_cron` menjadwalkan expiry per menit dan pembersihan audit remote harian
bila tersedia. Bila paket/izin cron tidak tersedia, pakai Supabase Dashboard
Scheduled Function untuk memanggil `expire_remote_commands` dan
`cleanup_remote_commands` dengan `SUPABASE_URL` serta
`SUPABASE_SERVICE_ROLE_KEY`; ini fallback opsional dan tidak mempengaruhi
delivery real-time.~~ *(`expire_remote_commands`/`cleanup_remote_commands`
sudah dihapus di Task 1-4 Major Update, 2026-08-30 — tidak ada lagi
scheduler remote-command. Table occupancy tracking punya scheduler
retensinya sendiri: `cleanup_qr_scan_events` (30 hari) dan
`cleanup_table_escort_intents` (90 hari), keduanya via `pg_cron` — lihat
migrasi `20260829010000_table_occupancy_schema.sql`.)* Ini bukan scheduler
owner retention. Lihat
[Owner retention runbook](docs/supabase-super-admin-remote-audio.md#owner-retention)
untuk mode scheduler owner `pg_cron` dan `edge_required`.

> Jangan commit file `.env`. `AUTH_SECRET` dan `DASHBOARD_PASSWORD` wajib untuk
> dashboard/sesi; lima variabel remote hanya diperlukan untuk mengaktifkan remote.

## Perintah

- `npm run dev` — development server
- `npm run build` — build untuk Vercel
- `npm run lint` — pemeriksaan kode

## Restaurant credential rollout

Kode Resto (restaurant login code) is stored as **plain text** in `public.restaurants.code`
(user decision, 2026-08-31 — reverted from the 23-Aug hash+AES-encrypted design after a
production incident where a stale master encryption key orphaned one restaurant's
credential). There is no encryption key to configure or rotate; `code` is matched by
direct, case-sensitive equality against the strict-uppercase format enforced by
`validateRestaurantCode` (`^[A-Z0-9-]{6,32}$`).

To provision or rotate a restaurant's code:

1. `npx supabase login`
2. `npx supabase link --project-ref YOUR_PROJECT_REF`
3. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` only in protected runtime environment.
4. Reprovision each row using its exact UUID. Do not pass a code by argv or environment. Preferred Windows flow keeps code out of argv, environment, and files. The command rotates code version and immediately revokes existing restaurant and crew sessions:

   ```powershell
   $code = Read-Host -AsSecureString
   [System.Net.NetworkCredential]::new('', $code).Password | node scripts/provision-restaurant-code.mjs --restaurant-id YOUR_RESTAURANT_UUID --code-stdin
   ```

   `--code-stdin` only accepts a pipeline; interactive TTY stdin is rejected. It removes one pipeline terminal newline and never prints credential material.

   Unix file input remains available for protected automation:

   ```bash
   chmod 600 /secure/path/restaurant-code
   RESTAURANT_CODE_FILE=/secure/path/restaurant-code node scripts/provision-restaurant-code.mjs --restaurant-id YOUR_RESTAURANT_UUID
   ```

   On Windows, `RESTAURANT_CODE_FILE` or `--code-file` must resolve below current user temp/home directories. Script runs `icacls /getowner` and requires current `USERNAME` ownership; it rejects broad `Everyone`, `BUILTIN\Users`, `Authenticated Users`, and `Users` read/write access, and fails closed when ACL inspection fails. Verify a temporary code file before provisioning with:

   ```powershell
   icacls "$env:TEMP\restaurant-code"
   ```

   `RESTAURANT_CODE_FILE` is only a file path, never credential content. Script rejects insecure files and never prints the code value.

Do not add credential value to files, shell history, SQL, fixtures, logs, or CI.

The reprovision script prints restaurant display name and UUID only. It calls the
service-role-only `rotate_restaurant_credentials` RPC directly with the plain code. It
never prints credential material.
