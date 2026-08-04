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

Aplikasi **tidak punya kredensial fallback**. Semua nilai dibaca dari environment
variable, dan login akan ditolak kalau belum diset:

| Variable | Dipakai untuk |
| --- | --- |
| `DASHBOARD_PASSWORD` | Password halaman dashboard `/` |
| `AUTH_SECRET` | Menandatangani cookie sesi, minimal 32 karakter |

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
2. Tambahkan environment variables:
   - `AUTH_SECRET`: string acak minimal 32 karakter.
   - `DASHBOARD_PASSWORD`
3. Deploy. Build command dan target server Vercel sudah dikonfigurasi.

Tidak ada storage yang perlu dihubungkan.

> Jangan commit file `.env`. Aplikasi tidak punya kredensial default — semua wajib
> diset lewat environment variable.

## Perintah

- `npm run dev` — development server
- `npm run build` — build untuk Vercel
- `npm run lint` — pemeriksaan kode
