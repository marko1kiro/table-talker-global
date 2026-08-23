# Table Talker

Soundboard panggilan meja berbasis TanStack Start dan Vercel.

Seluruh audio **ikut di-bundle bersama deployment**. Aplikasi tidak memanggil
storage atau API eksternal apa pun untuk memutar suara — jadi tidak ada kuota
penyimpanan/operasi yang bisa habis, dan tidak ada tombol yang tiba-tiba bisu.

## Menjalankan lokal

```bash
npm install
cp .env.example .env
# isi nilainya, lalu:
npm run dev
```

### Kredensial

Setup dashboard awal hanya membutuhkan `AUTH_SECRET` dan `DASHBOARD_PASSWORD`.
Lima variabel fitur remote bersifat opsional: `SUPER_ADMIN_PASSWORD` serta empat
variabel Supabase. Tanpanya, dashboard dan soundboard bundled tetap berjalan,
tetapi remote audio dinonaktifkan secara fail-open.

| Variable                    | Dipakai untuk                                       |
| --------------------------- | --------------------------------------------------- |
| `DASHBOARD_PASSWORD`        | Password halaman dashboard `/`                      |
| `SUPER_ADMIN_PASSWORD`      | Password khusus halaman remote audio `/super-admin` |
| `AUTH_SECRET`               | Menandatangani cookie sesi, minimal 32 karakter     |
| `VITE_SUPABASE_URL`         | URL Supabase publik untuk browser crew              |
| `VITE_SUPABASE_ANON_KEY`    | Anon key Supabase publik untuk browser crew         |
| `SUPABASE_URL`              | URL Supabase untuk server Super Admin               |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key Supabase untuk server Super Admin  |

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

Audio hidup di dalam repo dan diproses oleh pipeline aset Vite:

```text
src/assets/audio/
├── tables/
│   ├── 1.mp3
│   ├── 2.mp3
│   └── ... 70.mp3
└── announcements/
    ├── seating.mp3
    ├── outside-food.mp3
    ├── no-smoking.mp3
    └── jam-buka-resto.mp3
```

Nama file meja wajib `<nomor-meja>.mp3` dengan nomor 1–70. `src/lib/audio.ts`
memindai folder tersebut saat build dan menyusun katalognya otomatis — tidak ada
daftar file yang perlu ditulis manual.

### Cara mengganti audio

1. Ganti/tambah file MP3 di `src/assets/audio/**` (nama file tetap).
2. Commit dan push.
3. Vercel otomatis deploy ulang. Selesai.

Vite menuliskan nama file ber-hash konten (mis. `1-a1b2c3d4.mp3`), jadi:

- file audio aman di-cache selamanya oleh browser dan CDN, dan
- begitu isi audio berubah, URL-nya berubah juga — staf tidak akan terjebak
  memutar audio versi lama dari cache.

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
secara fail-open; dashboard dan soundboard audio bundled tetap berfungsi.

Tidak ada storage yang perlu dihubungkan.

### Super Admin remote audio

`/super-admin` memakai `SUPER_ADMIN_PASSWORD` terpisah dari dashboard. Pilih crew
yang siap dan audio, lalu kirim perintah. Aplikasi tetap fail-open: bila Supabase
atau Realtime tidak dikonfigurasi, dashboard dan soundboard audio bundled normal
tetap berjalan; crew menampilkan remote tidak tersedia, sedangkan `/super-admin`
menampilkan `Realtime offline` dan tidak dapat mengirim perintah.

Crew memasukkan nama lalu menekan `LANJUT!!`. Gesture ini membuka sumber audio
bundled yang nyata dalam keadaan muted agar browser mengizinkan pemutaran remote.
Hanya crew audio-ready, tab terlihat, dan koneksi aktif yang mengirim heartbeat
foreground setiap 10 detik yang dapat dipilih; kelayakannya berakhir setelah 30
detik tanpa heartbeat. Perintah berlaku 5 detik, diproses sekali tanpa replay saat
duplikat, reconnect, tab tersembunyi, atau perangkat kembali aktif. Audit perintah
disimpan tujuh hari.

Android Chrome dan iOS Safari membatasi autoplay serta dapat menangguhkan tab,
layar terkunci, atau audio di latar belakang. Jangan menjanjikan pemutaran pada
kondisi tersebut: buka crew di foreground, tekan `LANJUT!!`, lalu gunakan pemulihan
`Aktifkan Suara` bila browser menolak audio.

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

   Migrasi mengaktifkan RLS deny-by-default, memberi crew hanya akses session dan
   perintah miliknya melalui RPC, serta menambahkan `crew_sessions` dan
   `remote_commands` ke Realtime publication. Jangan membuat policy tabel longgar
   atau memberi service-role key ke client.

`pg_cron` menjadwalkan expiry per menit dan pembersihan audit harian bila tersedia.
Bila paket/izin cron tidak tersedia, pakai Supabase Dashboard Scheduled Function
untuk memanggil `expire_remote_commands` dan `cleanup_remote_commands` dengan
`SUPABASE_URL` serta `SUPABASE_SERVICE_ROLE_KEY`; ini fallback opsional dan tidak
mempengaruhi delivery real-time. Detail fungsi ada di
`docs/supabase-super-admin-remote-audio.md`.

> Jangan commit file `.env`. `AUTH_SECRET` dan `DASHBOARD_PASSWORD` wajib untuk
> dashboard/sesi; lima variabel remote hanya diperlukan untuk mengaktifkan remote.

## Perintah

- `npm run dev` — development server
- `npm run build` — build untuk Vercel
- `npm run lint` — pemeriksaan kode

## Restaurant credential rollout

`RESTAURANT_CODE_ENCRYPTION_KEY` is server-only 32-byte base64url key. Generate once
in approved secret manager. Do not expose through `VITE_`, Git, SQL, CI output, logs,
or browser. Key loss requires credential reset. Key compromise requires rotate each
credential after replacing key.

Run staged release. Do not apply cleanup before every active restaurant has derived
credential fields.

1. Deploy compatibility release with restaurant-code feature flag off.
2. `npx supabase login`
3. `npx supabase link --project-ref YOUR_PROJECT_REF`
4. Run `npx supabase db push --include-all`. Expected: additive and provisioning migrations apply, then cleanup stops with `UNPROVISIONED_RESTAURANT_CREDENTIALS`. Confirm migrations `20260823110000_restaurant_code_credentials_additive.sql` and `20260823111500_provision_restaurant_credentials.sql` exist remotely; do not bypass guard.
5. Configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `RESTAURANT_CODE_ENCRYPTION_KEY` only in protected runtime environment.
6. Reprovision each row using exact UUID only. Do not pass a code by argv or environment. Preferred Windows flow keeps code out of argv, environment, and files. The command rotates code version and immediately revokes existing restaurant and crew sessions:

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

    `RESTAURANT_CODE_FILE` is only a file path, never credential content. Script rejects insecure files and never prints code, hash, or ciphertext.

7. Reprovision every active restaurant credential after deploying this release. Pilot sudah direprovisioning. Fallback HKDF legacy sudah dihapus, jadi semua kredensial wajib reprovisioning sebelum login. Do not add credential value to files, shell history, SQL, fixtures, logs, or CI.
8. Enable feature flag after monitoring provisioning audit records. Apply cleanup only then: `npx supabase db push --include-all`. Migration `20260823120000_remove_legacy_restaurant_code.sql` aborts if any restaurant lacks derived credentials.

The reprovision script prints restaurant display name and UUID only. It computes hash and ciphertext in memory, then calls service-role-only `rotate_restaurant_credentials` RPC. It never prints credential material.
