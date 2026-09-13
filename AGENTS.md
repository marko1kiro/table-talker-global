# Aturan kerja wajib

## Gate kualitas & branch

- Sebelum commit + push, jalankan full quality gate: `npm run verify` (test + typecheck + lint + build). Commit/push hanya bila exit 0.
- `main` adalah protected branch (PR-only, required check `CI / verify`, strict, enforce_admins). Alur: branch -> push -> PR -> tunggu CI hijau -> squash merge. Jangan pernah push langsung ke `main`; jangan pakai `--no-verify` atau bypass apapun.

## Keseriusan proyek

- Ini sistem produksi untuk kebutuhan restoran sungguhan. Trial pilot CKRBUL dimulai 14-09-2026 — crew bisa sedang online bekerja kapan saja saat perubahan mendarat.
- Prioritas #1: JANGAN sampai menendang keluar (memoles) crew yang sedang login. Setiap perubahan wajib ditanyakan: "apa efeknya ke sesi yang sedang hidup?" (sesi auth GoTrue, role session token, device pin, tab yang masih terbuka dengan bundle lama).
- Kejujuran di atas hijau: DILARANG memalsukan hasil test, men-skip/menyembunyikan test, menempel-tambal kode agar assertion lama lolos, atau menunda bugKnown-fail. Setiap merah harus diperbaiki atau dilaporkan apa adanya sebagai blocker.
- Regresi ketemu -> perbaiki langsung, jangan lanjut ke task lain dengan merah. Blocker -> cari jalur alternatif yang aman; kalau tidak ada, lapor BLOCKED jujur. Dilarang mengarang "sudah jalan" tanpa bukti.

## Aset penting database (HARAM dihapus/diubah tanpa perintah eksplisit pemilik)

- 9 data master restoran; seluruh QR table token + batch export; seluruh manifest/katalog/file audio; `crew_accounts` + `crew_role_sessions`; `manager_accounts`, `area_manager_accounts`, registry staff, super admin; `role_session_tokens` yang sedang dipakai sesi hidup; schema `realtime`.
- Setiap migration yang me-drop/mengubah objek WAJIB menyertakan bukti pre-count dan post-count aset di atas (preseden evidence doc Poin 1/2/3). Drop objek di luar scope yang disepakati = pekerjaan cacat, walau semua test hijau.

## Disiplin leader & subagent

- Semua coding: TDD ketat (test ditulis lebih dulu dan DILIHAT GAGAL sebelum implementasi) + fresh subagent per task agar konteks hemat; review dua tahap (spec compliance, baru code quality).
- Leader TIDAK boleh langsung percaya klaim "APPROVED" subagent: diff diperiksa ulang sendiri, test kunci dijalankan ulang sendiri, dan setiap bukti penting (output perintah, run CI, angka produksi) diverifikasi independen sebelum dinyatakan selesai.
- Laporan wajib evidence konkret: SHA commit, ID run CI, angka query, URL deploy. Tanpa evidence = belum selesai.

## Secret & credential

- PAT, API key, password, recovery code, dsb. TIDAK PERNAH masuk repo, commit, log, komentar PR, atau output terminal.
- Kebutuhan API Vercel: pakai skill `vercel-api` (PAT permanen, bukan MCP resmi) — jangan pernah mencetak token.
- Supabase produksi lewat MCP yang sudah dikonfigurasi; ubah config GoTrue hanya lewat prosedur yang disetujui pemilik (runbook Poin 3).
