# Evidence — Poin 7 audio tahan offline → production

Tanggal: 2026-09-15 · Status: **DRAF — menunggu perintah push/PR pemilik**

## 1. Commits (branch lokal `poin-7`, BELUM push)
```
f6dc0a3 docs(poin-6.1): evidence produksi ikut PR Poin 7 (hemat CI)
f0875cf test(poin-7): source-scan guards offline-tanpa-SW + teks Profil ringkas
f63839e fix(poin-7): retry gagal refetch manifest fresh — grant 10 mnt (review Task 3)
a63daa3 feat(poin-7): wiring SS — background sync stale, Profil umur audio, re-probe online
10b0f7e fix(poin-7): telemetri SYNC_OFFLINE di catch + header paragraf (review Task 2)
be9520a feat(poin-7): SyncDialog penentu mode — offline-fallback snapshot + lapor versi
a8db234 chore(poin-7): hapus import tak terpakai di test store (review Task 1)
7ddb207 feat(poin-7): snapshot manifest store + keputusan startup + umur kompak
472d596 docs(poin-7): plan implementasi — 4 task TDD, self-review bersih
9df991d docs(poin-7): spec audio tahan offline — snapshot manifest + auto-sync
```

## 2. CI
- Menunggu PR atas perintah pemilik (belum ada run).

## 3. Perubahan DB
- NOL — tidak ada migration Poin 7 (snapshot di localStorage perangkat).

## 4. Field test (prosedur, BELUM dijalankan)
1. Tablet SS online + sync sukses → matikan WiFi → reload → SS bunyi dari cache; dropdown Profil tampil "Offline · {umur}".
2. Nyalakan WiFi → dalam ≤30 dtk auto re-check; pill tidak muncul bila versi sama.
3. Upload katalog baru (versi naik) → prefetch berikutnya background sync + pill "Sync audio x/y" → toast "Audio diperbarui"; umur Profil reset.
4. "Coba sambung lagi" di Profil saat offline → diam (tidak ganggu); saat online + basi → sync.
5. Reload tengah background-sync → progres hilang wajar, snapshot lama tetap dipakai (tidak corrupt).
6. Logout → login resto lain → snapshot resto lama tidak dipakai.
7. Sesi crew/manager/SS yang hidup: tidak ada yang terlogout (nol sentuhan auth).

## 5. Rollback
- Revert deploy. Snapshot localStorage harmless (load tervalidasi, rusak → first-ever sync).
