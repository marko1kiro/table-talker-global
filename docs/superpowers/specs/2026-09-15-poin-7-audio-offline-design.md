# Poin 7 — Audio Tahan Offline (last-known-good + auto-sync) — Design

Tanggal: 2026-09-15 · Status: APPROVED lisan pemilik (Q1–Q4 + pendekatan P1 + desain 3 seksi, chat 15 Sep)

## 0. Masalah (gejala lapangan)

Reload SS saat WiFi mati = station mati total (dead-end "Tidak dapat terhubung ke server" di SyncDialog), padahal file audio sudah pernah ke-download dan ada di Cache Storage. Fondasi yang sudah ada dan dipertahankan: Cache Storage `table-talker-audio-v1`, download concorrent + retry + verifikasi hash SHA-256 (`src/lib/audio-sync.ts`), SyncDialog blocking wajib pasca-login, manifest via server fn bertenant-token.

## 1. Keputusan desain (ringkas)

- **P1 — snapshot manifest lokal + cek versi saat prefetch.** Tanpa Service Worker, tanpa tabel DB baru, tanpa dependensi baru.
- Reload offline → **otomatis** jalan dari cache terakhir (tanpa konfirmasi).
- Online + versi katalog beda → **background auto-sync** (SS tetap bunyi dari cache lama); blocking modal **hanya** untuk sync pertama (belum punya cache sama sekali).
- Umur versi audio tampil di **dropdown Profil** (1 baris ringkas + truncate, tidak di layar utama) + aksi "Coba sambung lagi".
- Tanpa batas umur cache (mogok bunyi saat rush lebih fatal daripada basi; umur selalu jujur terlihat).

## 2. Snapshot manifest

- Key `lm.audio.manifest.v1` (localStorage, per-restaurant): `{ restaurantId, catalogVersion, fetchedAt, items: [{ audioId, hash, size }] }`.
- Ditulis HANYA setelah sync sukses penuh (semua file lolos verifikasi hash). Dihapus saat ganti resto / "Keluar akun".
- Ukuran tipikal ~3KB. Format berversi implisit via key (`v1`) untuk migrasi masa depan.

## 3. Matriks prefetch SS (menggantikan fetch-manifest-buta)

Coba `getRestaurantManifest` dengan timeout pendek (±8 dtk):

| Kondisi | Perilaku |
|---|---|
| Online + versi sama | Verifikasi delta cepat (file hilang/berubah → download itu saja, background) → SS jalan |
| Online + versi beda | Background sync full-delta otomatis + pill progres; SS bunyi dari cache lama |
| Offline / tak terjangkau | Mode offline otomatis dari snapshot |
| Belum pernah sync | Modal blocking SyncDialog seperti sekarang (satu-satunya keadaan boleh blokir) |

Sumber versi server: `catalog_version` dari respons manifest yang sudah ada (tanpa RPC baru).

## 4. UX

- **Pill progres** non-blocking di header SS ("Sync audio 7/24") → selesai jadi toast "Audio diperbarui"; gagal sebagian → pill jadi tombol "3 gagal — ketuk untuk ulangi" (retry hanya yang gagal).
- **Dropdown Profil** (`ProfileMenu`, dipakai `Header.tsx` SS): 2 baris status audio, format kompak 1 baris + `truncate`, tanpa wrap: "v12 · 2 jam" (hijau) / "Offline · 3 hr" (kuning) + aksi "Coba sambung lagi" (paksa cek versi sekarang). Wajib responsif Android Chrome + iOS Safari.
- **Playback cache-first**: resolver cek Cache Storage dulu (cocok hash snapshot) → kena langsung bunyi; luput → fetch network + simpan; network mati + luput → lewati file itu + catat (bukan crash). Key cache + format file tidak berubah.
- **Re-probe**: event `online` existing (hook Poin 6) → cek versi sekali (debounce).

## 5. Keamanan sesi & rilis

- Nol perubahan auth/realtime/role-session; nol migration; snapshot per-restaurant di localStorage.
- Urutan rilis: PR → CI hijau → merge → deploy jam sepi (Update Prompt existing mengantar reload).
- Rollback: revert deploy; snapshot lokal harmless (format tervalidasi saat load, rusak → diabaikan + sync ulang).

## 6. Testing (TDD)

- Modul murni `audio-manifest-store.ts` (load/save/clear + `decideAudioStartup` + format umur kompak) dites tanpa DOM.
- SyncDialog/offline-path di jsdom: fetch dimatikan → fallback snapshot; aksi sambung-ulang; blocking hanya first-ever.
- Guard: tidak ada Service Worker; tidak ada tabel DB baru; teks Profil 1 baris (class truncate + formatter).
- Field test: matikan WiFi → reload → SS bunyi + umur di Profil; update katalog → prefetch auto-sync background.

## 7. Out of scope

Kasir/satgas/clear-up (tak pakai audio); SOP hotspot (dokumen); perubahan format audio/R2; batas umur cache keras.
