# Table Talker

Soundboard panggilan meja berbasis TanStack Start, Vercel, dan Vercel Blob.

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
| `MANAGE_USERNAME` | Username halaman `/manage` |
| `MANAGE_PASSWORD` | Password halaman `/manage` |
| `AUTH_SECRET` | Menandatangani cookie sesi, minimal 32 karakter |

Buat `AUTH_SECRET` dengan `openssl rand -hex 32`. Di production, server menolak
start kalau `AUTH_SECRET` kosong atau kurang dari 32 karakter.

> Jangan pernah menuliskan nilai kredensial di `README.md`, `.env.example`, atau
> di dalam kode. Simpan hanya di `.env` lokal (sudah di-gitignore) dan di
> environment variables Vercel.

## Struktur audio

Taruh MP3 yang ingin disinkronkan saat build di:

```text
audio/
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

Paket ini memuat 70 audio meja dan 4 pengumuman. Dashboard membaca file `table-talker/tables/1.mp3` sampai `70.mp3`, serta keempat file dalam `announcements/`. Audio meja dapat di-upload, diganti, dipreview, dan dihapus lewat `/manage`.

### Sinkronisasi audio saat build

`prebuild` menjalankan `scripts/upload-audio.mjs`. Aturannya:

| Folder | Perilaku saat deploy |
| --- | --- |
| `audio/announcements/` | Disinkron, **hanya file yang belum ada** di Blob. |
| `audio/tables/` | **Dilewati total.** Sound meja adalah konten yang dikelola lewat `/manage`. |

Skrip **tidak pernah menimpa** file yang sudah ada di Blob. Jadi deploy berapa kali pun tidak akan mengubah sound meja maupun pengumuman yang sudah pernah diganti manual.

Dua escape hatch, disetel manual saat menjalankan build (jangan dipasang permanen di Vercel):

- `AUDIO_SYNC_TABLES=1` — ikut sinkron folder `tables/`. Untuk mengisi environment baru yang Blob-nya masih kosong. Tetap tidak menimpa.
- `AUDIO_SYNC_FORCE=1` — izinkan menimpa file yang sudah ada. **Destruktif**, hanya untuk reset audio yang disengaja.

> Latar belakang: versi awal skrip ini meng-upload seluruh folder `audio/` dengan `allowOverwrite: true`, sehingga setiap deploy menimpa 70 sound meja di Blob dengan salinan lama yang ada di repo. Aturan di atas mencegah itu terulang.

## Deploy ke Vercel

1. Import repository ke Vercel.
2. Buka **Storage**, buat Blob Store, lalu hubungkan ke project. Vercel akan menambahkan `BLOB_READ_WRITE_TOKEN`.
3. Tambahkan environment variables:
   - `AUTH_SECRET`: string acak minimal 32 karakter.
   - `MANAGE_USERNAME`
   - `MANAGE_PASSWORD`
   - `DASHBOARD_PASSWORD`
4. Deploy. Build command dan target server Vercel sudah dikonfigurasi.

> Jangan commit file `.env`. Aplikasi tidak punya kredensial default — semua wajib diset lewat environment variable.

## Perintah

- `npm run dev` — development server
- `npm run build` — upload MP3 dari `audio/`, lalu build untuk Vercel
- `npm run lint` — pemeriksaan kode
