# Restyle Dialog Konfirmasi Crew (Kasir / Satgas / Clear Up) — Desain

Tanggal: 2026-09-03
Status: disetujui user (pilihan A — tombol konfirmasi seragam)

## Latar

Audit backlog UI menyisakan satu item: restyle dialog "Tandai Meja Terisi/Kosong"
(Kasir, Clear Up) dan "Escort" (Satgas) memakai shadcn sesuai aturan tampilan:

- Crew Kasir/Satgas/Clear Up: shadcn polos, modern, ringan; bukan neo-brutalism.
- Station SS tetap neo-brutalism; hanya header boleh diseragamkan.
- Super Admin hanya disentuh sesuai scope item yang disetujui.

Fakta lapangan (diverifikasi dari source, 2026-09-03):

- Ketiga dialog SUDAH memakai komponen shadcn `AlertDialog` (`ui/alert-dialog.tsx`).
  Tidak ada penggantian komponen yang diperlukan.
- Yang belum mengikuti gaya crew adalah isi dialognya: `AlertDialogAction`
  memakai `ownerPrimaryButtonClass` (gaya Super Admin: slate-950 pekat +
  hover amber) dan `AlertDialogCancel` memakai gaya default bawaan.
- Acuan gaya crew yang sudah final ada di `src/components/CrewHeader.tsx`
  (header sticky, kartu daftar meja: `rounded-2xl`, border `slate-200`,
  `bg-white`, `shadow-sm`, tombol ikon `rounded-xl` putih garis abu).

Lokasi dialog:

| Route | Dialog | Judul | File |
|---|---|---|---|
| `/kasir` | Tandai meja terisi | "Tandai Meja {confirmTable} Terisi?" | `src/routes/kasir/index.tsx` |
| `/satgas` | Escort intent | "Escort ke Meja {escortTable}?" | `src/routes/satgas/index.tsx` |
| `/clear-up` | Tandai meja kosong | "Tandai Meja {confirmTable} Sudah Dibersihkan?" | `src/routes/clear-up/index.tsx` |

## Keputusan desain (disetujui user)

1. **Tombol konfirmasi ("Ya, ...")** — satu gaya seragam untuk ketiga dialog,
   gaya tombol polos crew (bukan gaya owner): sudut membulat, tinggi ramah
   jempol, warna netral gelap lembut, teks putih. Tidak ada variasi warna
   per-stasiun (pilihan A).
2. **Tombol "Batal"** — gaya tombol sekunder crew: putih, border `slate-200`,
   hover `slate-50` (senada tombol ganti-tampilan di CrewHeader).
3. **Kotak dialog** — memakai gaya bawaan shadcn yang sudah bersih; cukup
   dipastikan sudut & border senada kartu crew (tidak di-neo-brutalist-kan).
4. **Perilaku tidak berubah sama sekali**: teks judul/deskripsi, urutan tombol,
   handler `onClick`, pola `setProcessingTable`/mutate yang bertahan setelah
   dialog tertutup. Semua test kontrak dialog yang ada harus tetap hijau.
5. **Penempatan token gaya**: tombol polos crew diekspor dari
   `src/components/CrewHeader.tsx` (satu sumber, dipakai 3 route), bukan
   salin-tempel class di tiga tempat.

## Out of scope (dicatat eksplisit)

- Tombol "Konfirmasi" pada daftar tunggu escort Satgas
  (`src/routes/satgas/index.tsx` ~baris 317, masih `ownerPrimaryButtonClass`)
  — bukan bagian dialog; menjadi item kecil terpisah bila user menyetujui.
- Station SS, Super Admin, header crew: tidak disentuh.
- Tidak ada perubahan database/migrasi/RPC.

## Rencana verifikasi

- Strict TDD: test kontrak baru membuktikan isi dialog crew TIDAK lagi
  memakai `ownerPrimaryButtonClass` dan MEMAKAI token gaya crew baru
  (MERAH dulu, lalu HIJAU setelah implementasi).
- Test kontrak dialog yang ada (judul, handler, `markOccupied.mutate`,
  `escortMutation.mutate`, `markEmpty.mutate`) wajib tetap hijau tanpa edit.
- `npm run verify` penuh (test + typecheck + lint + build) exit 0 sebelum
  commit/push `main`; verifikasi remote SHA + deployment Vercel Production
  READY + alias domain; probe HTTP 200.
- Tidak ada migrasi → CI replay tidak terpicu (path filter) — dicatat sebagai
  perilaku normal, bukan kegagalan.

## Risiko

- Rendah: perubahan murni className + ekspor konstanta baru; nol perubahan
  logika, nol perubahan DB, rollback trivial via git revert.
