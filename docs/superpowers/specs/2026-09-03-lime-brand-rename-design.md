# Rename Brand TABLE TALKER → LIME — Desain

Tanggal: 2026-09-03
Status: disetujui user (pilihan B — rename total seluruh app)

## Latar

App kini bernama LIME ("Liat Meja"), tetapi konsol Owner/Super Admin, halaman
login `/super-admin`, footer, dan halaman publik masih memakai brand lama
"TABLE TALKER" — ±30 kemunculan di 13 file source + 2 test kontrak. Halaman
crew sudah benar (`lime-logo.webp`, judul "LIME — Panggilan Meja Restoran").

## Keputusan desain (disetujui user)

1. **Brand string tunggal: "LIME"** — konsisten dengan halaman crew.
2. **Login `/super-admin` (AuthGate — hanya dipakai oleh super-admin/route.tsx):**
   - Brand lockup desktop & mobile: ikon `ShieldCheck` diganti `<img src="/lime-logo.webp">`,
     teks "TABLE TALKER" → "LIME".
   - Tagline "Restaurant audio operations" → "Panggilan meja & operasional resto".
   - Headline "Operasional audio yang cepat, jelas, dan terkendali." →
     "Operasional resto yang cepat, jelas, dan terkendali."
   - Meta title route: "Owner Console - Table Talker" → "Owner Console - LIME".
3. **Shell console owner (super-admin/route.tsx):** header mobile + sidebar
   memakai logo LIME + teks "LIME"; label "Owner Console" tetap.
4. **Semua sebutan lain:** dashboard (2x), footer, landing meta (title + og),
   about, faq, help, contact, privacy-policy, terms-of-use, pesan WhatsApp
   laporan kendala (`help-message.ts`) → "LIME".
5. **Asset:** `public/table-talker-logo.webp` (tak terreferensi) dihapus.
6. **TDD:** 2 test lama yang mengunci teks lama (`help-page-source`,
   `help-message`) di-update ke "LIME" terlebih dahulu; test pengawas baru
   (`tests/brand-rename.test.ts`) memastikan nol "TABLE TALKER" di `src`
   dan brand "LIME" hadir di AuthGate + shell console.

## Sengaja tidak diubah (dengan alasan)

- Cookie `table-talker-session` (`auth.server.ts`) — identifier internal;
  rename memaksa logout semua sesi owner tanpa manfaat tampilan.
- Label "Owner Console" — sebutan peran, akurat.
- Kata "soundboard" (about/faq/privacy) — masih akurat untuk stasiun SS.
- Sebutan "Mie Gacoan Kampung Bulu" pada meta landing — nama resto deployment.

## Verifikasi

- MERAH (test pengawas + 2 test lama) → rename → HIJAU.
- `npm run verify` penuh exit 0 → review diff → push `main` → verifikasi
  remote SHA; CI replay tidak terpicu (tanpa perubahan `supabase/`); Vercel
  Production READY + alias domain; probe HTTP 200 + cek `<title>` live.
