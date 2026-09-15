# Evidence — Poin 6.1 crew password login + update prompt → production

Tanggal: 2026-09-15 · PR #37 → squash `e9ab5c8` · Status: **DEPLOYED, menunggu field test pemilik**

## 1. Commits & PR

- Branch `poin-6-1` → PR #37 → squash-merge `e9ab5c8` ("Poin 6.1: login password crew + update prompt semua role (#37)").
- CI pada HEAD PR (`32681a4`): `verify` PASS ×2 (runs 34919071779, 34919073469 — tests 1671 passed, typecheck, lint, build), `db-reset` PASS (run 34919073560), Vercel preview PASS. Satu merah di tengah jalan (lint prettier 3 baris di test DB baru) → diperbaiki (`32681a4`), hijau penuh, baru merge. Tanpa bypass.
- File produksi (7): `CrewLoginFlow.tsx` (rewrite email-first), `UpdatePrompt.tsx` + `update-prompt.ts` (baru), `browser-auth.ts` (+2 fn), `crew-auth.server.ts` (+`crewLoginMethod`), `__root.tsx` (+mount), migration `20260915120000_crew_auth_method.sql`. Nol perubahan config/dep/CI/lock.

## 2. Apply migration produksi ( additive, SEBELUM merge — urutan wajib)

- Metode: MCP Supabase sesi ini wedge (timeout `-32001` semua tool; token CONFIG+USERENV valid HTTP 200; binari server sehat via stdio langsung) → dipakai **channel identik** (binari + project-ref + token user yang sama) via stdio, tiap perintah tercatat di `C:\Users\dirga\AppData\Local\Temp\opencode\mcp_stdio.ps1` + file JSON panggilan.
- **Pre** (read-only, ±09:05 WIB): `tables_public=46`, `qr_tokens=325`, `crew_acc=13`, `role_tokens=54`, `mgr_acc=7`, `am_acc=2`, `restos=9`, `manifests=946`, fungsi baru `0`.
- **Apply**: `apply_migration` nama `crew_auth_method` → `{"success":true}`.
- **Post**: `tables_public=47` (+1 `crew_auth_method_limits` saja), fungsi baru `2`, SEMUA angka aset IDENTIK (`role_tokens` tetap 54 = nol invalidasi sesi), smoke `crew_auth_method('tidak-ada@contoh.test')='otp'` + `reserve_crew_auth_method=true`, baris smoke di-quota-table dihapus lagi.
- Tidak ada patch config GoTrue; jwt_exp tetap 28800 (T3).

## 3. Deploy production

- Merge `e9ab5c8` → Vercel production `READY`; `lihatmeja.com` 200, bundle baru `index-Bi3sG8Lo.js`.
- Momen uji Update Prompt: tab lama (bundle `index-CKRkHyh1.js` era Poin 6) HARUS menampilkan modal "Ada Update sistem, Tolong refresh halaman ya." ≤5 menit / saat tab difokuskan.

## 4. Field test pemilik (penutup DONE — BELUM dijalankan)

1. Crew lama tanpa password: email → kode → Buat Password → checkin → claim jalan.
2. Crew baru: email → kode → Buat Password → resto → pairing → approve manager → checkin.
3. Login kedua pakai password: <3 detik, tanpa email.
4. Lupa password: link "Belum bisa masuk? Kirim kode email" → kode → set ulang → lanjut.
5. iOS Safari + Android Chrome: modal update muncul pasca-deploy ini; tombol Refresh (reload bundle baru) + Nanti Aja (diam sampai sesi berikutnya) berfungsi.
6. Sesi crew/manager/SS yang sedang hidup: TIDAK ada yang terlogout (role_tokens 54 utuh pasca-migration; pantau pasca-deploy).

## 5. Rollback

Revert commit deploy di Vercel; RPC/tabel additive dibiarkan harmless; password yang terlanjur dibuat crew tetap valid (akunnya otomatis masuk mode password).

## 7. Follow-up pasca-deploy (15 Sep siang)

- Laporan "akun lama diminta password" (marko1.kiro@gmail.com): DIINVESTIGASI, verdict BENAR — akun itu dibuat 07:49 WIB hari yang sama (OTP + pairing normal) dan password-nya diset 09:39 WIB lewat layar Buat Password baru (atau dashboard). Bukan bug kode. Unblock: link kirim-kode-email → set ulang password.
- Micro-fix atas permintaan pemilik: link "Belum bisa masuk? Kirim kode email" kini SELALU tampil di layar password (PR #38 → `78adc6b`, CI hijau, production READY). Postur keamanan tidak berubah.

## 6. Catatan insiden alat

Pipe MCP Supabase sesi OpenCode ini wedge total mulai ±08:55 WIB (semua tool timeout; proyek ACTIVE_HEALTHY). Diagnosis + fallback stdio di atas. Pemilik disarankan restart aplikasi OpenCode di lain waktu agar MCP spawn ulang segar (helper stdio tetap tersimpan bila dibutuhkan lagi).
