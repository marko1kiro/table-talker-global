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

| Variable | Dipakai untuk |
| --- | --- |
| `DASHBOARD_PASSWORD` | Password halaman dashboard `/` |
| `SUPER_ADMIN_PASSWORD` | Password khusus halaman remote audio `/super-admin` |
| `AUTH_SECRET` | Menandatangani cookie sesi, minimal 32 karakter |
| `VITE_SUPABASE_URL` | URL Supabase publik untuk browser crew |
| `VITE_SUPABASE_ANON_KEY` | Anon key Supabase publik untuk browser crew |
| `SUPABASE_URL` | URL Supabase untuk server Super Admin |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key Supabase untuk server Super Admin |

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
# Tenant PIN setup

Before applying `20260823102000_restaurant_pin_hash.sql`, set PostgreSQL setting
`app.pilot_restaurant_pin_hash` to lowercase SHA-256 hex of pilot PIN. Generate it
server-side, for example: `node -e "console.log(require('node:crypto').createHash('sha256').update(process.env.PILOT_RESTAURANT_PIN).digest('hex'))"`.
