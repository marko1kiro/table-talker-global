# Back Button — Halaman Login Manager

Tanggal: 6 September 2026
Status: disetujui (design A)

## Masalah

Halaman `/manager/login` tidak punya jalur balik selain tombol browser. Pengunjung yang
membuka halaman dari link/bookmark (tab baru, history kosong) tersangkut tanpa cara
kembali ke aplikasi.

## Keputusan

- **Tujuan**: tombol kembali **statis ke home `/`** (deterministik, aman untuk tab baru).
- Browser `history.back()` ditolak: kosong pada tab baru dan bisa mengembalikan ke form
  register yang sudah terisi.

## Design

- **File yang berubah**: hanya `src/routes/manager/login.tsx`.
- **Elemen**: tombol ghost "Kembali" di kiri-atas kolom form, sebelum blok heading.
  - Markup: `<Link to="/">` (TanStack Router, sudah diimport) + ikon `ArrowLeft`
    (`size-4`, dari `lucide-react`).
  - Kelas: `mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ta-gray-500
    transition hover:text-brand-500 dark:text-ta-gray-400 dark:hover:text-brand-400`.
- **Di luar scope**: halaman `/manager/register` tidak berubah (bisa menyusul dengan pola
  yang sama bila diminta).

## Testing

- TDD: `tests/manager-login-back.test.ts` dibuat dulu (MERAH), berisi source assertion
  terhadap `src/routes/manager/login.tsx`:
  - mengandung `to="/"` (Link home),
  - teks `Kembali`,
  - ikon `ArrowLeft`.
- Hijau setelah implementasi; gate penuh `npm run verify` exit 0.

## Risiko

- Minim: perubahan presentasional murni pada satu halaman, tidak menyentuh logika auth.
