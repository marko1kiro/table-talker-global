# Breakdown Task 12 — Clear Up Route

- **Repo/branch:** `marko1kiro/table-talker-global` @ `main` (setelah commit `ef3df9c`, Task 11)
- **Rencana acuan:** `docs/superpowers/plans/2026-08-29-table-occupancy-tracking.md`, bagian "Task 12: Clear Up Route"

## Ringkasan Eksekutif

Tidak ada bug/kesenjangan RPC yang menghalangi. `set_table_empty_cleanup` (Task 6) sudah lengkap, sudah punya wrapper server function di `src/lib/table-occupancy.server.ts`, dan sudah mengirim broadcast realtime `invalidate` sejak perbaikan audit pra-Task 10 (commit `5806757`) — diverifikasi langsung ke database live (`kjzxtmxdbcanvkgqqdow`) sebelum menulis kode: signature `set_table_empty_cleanup(p_restaurant_id uuid, p_table_number integer, p_session_token text)`, `security definer`, `grant ... to authenticated` — persis sama dengan yang dipanggil `setTableEmptyCleanup` di kode.

Ada **satu kesenjangan kecil** antara teks rencana dan infrastruktur bersama yang sudah dibangun (Task 9), diputuskan di bawah.

## Kesenjangan: "list adalah default alami" vs default global tunggal di `use-layout-preference.ts`

Teks rencana Task 12 Step 1 minta "list is the natural default here" untuk Clear Up — beda dari Kasir/Satgas yang defaultnya grid. Tapi `use-layout-preference.ts` (dibangun Task 9, dipakai Kasir & Satgas, sudah diuji) punya satu konstanta default tunggal (`"grid"`) yang dipakai untuk semua peran lewat `readLayoutPreference(role, storage)`.

**Opsi yang dipertimbangkan:**
1. Hardcode default "list" di dalam route Clear Up sendiri (mis. cek localStorage manual, kalau kosong panggil `setLayoutPreference("list")` sekali di effect pertama) — ditolak: menciptakan sumber kebenaran kedua untuk "apa default tampilan peran ini", di luar modul yang seharusnya jadi satu-satunya pemilik keputusan itu. Juga menulis ke localStorage secara implisit di awal (bukan cuma membaca), beda dari pola Kasir/Satgas yang murni lazy-read.
2. Buat default sadar-peran di `use-layout-preference.ts` sendiri — **dipilih**. Tambah `ROLE_DEFAULT_LAYOUT_PREFERENCE: Record<CrewRole, LayoutPreference>` (`clear_up: "list"`, sisanya tetap `"grid"`), dipakai di `readLayoutPreference`. Tidak mengubah signature fungsi apa pun, tidak mengubah perilaku Kasir/Satgas (dibuktikan lewat test baru khusus untuk itu di `tests/use-layout-preference.test.ts`), dan menjaga satu sumber kebenaran untuk default per peran.

**Keputusan:** Opsi 2. File yang diubah: `src/lib/use-layout-preference.ts`, `tests/use-layout-preference.test.ts`. Checklist Task 12 di dokumen rencana ditandai dengan catatan koreksi ini.

## Hal lain yang diperiksa, tidak ada masalah

- **Rute tujuan setelah login** (`ROLE_ROUTE_PATH` di `src/routes/index.tsx`) sudah mengarah ke `/clear-up` untuk role `clear_up` sejak Task 8 — cocok dengan file yang dibuat di sini (`src/routes/clear-up/index.tsx` → `createFileRoute("/clear-up/")`), tidak perlu diubah.
- **Broadcast realtime** untuk `set_table_empty_cleanup` sudah terpasang sejak audit pra-Task 10 (commit `5806757`) — begitu Clear Up menandai meja kosong, semua device lain (Kasir/Satgas) langsung ter-update tanpa refresh manual. Diverifikasi query langsung ke `pg_proc`/`information_schema.routine_privileges` di database live sebelum coding, bukan cuma dibaca dari teks migrasi.
- `get_table_occupancy_snapshot` sudah mengembalikan `occupied_at` per meja (dipakai Kasir sejak Task 10) — cukup untuk menghitung durasi terisi di klien tanpa RPC/kolom baru.
- Tidak ada tabel/kolom baru yang dibutuhkan — Task 12 murni UI + satu perluasan kecil pada infrastruktur bersama (default layout), tidak ada migrasi SQL yang diterapkan.

## Rencana Implementasi

**File baru:**
- `src/lib/clear-up-queue.ts` — logika murni: `sortedOccupiedTables(tables, nowMs)` (filter ke `status === "terisi"` dengan `occupied_at` valid, urut menurun berdasarkan durasi) dan `formatOccupiedDuration(durationMs)` (label Indonesia: "Baru saja" / "N menit" / "N jam" / "N jam M menit"). Dipisah dari route mengikuti pola yang sudah dipakai `satgas-escort-waitlist.ts`, supaya bisa diuji langsung tanpa lingkungan browser.
- `tests/clear-up-queue.test.ts` — 12 test, eksekusi nyata terhadap logika murni di atas.
- `src/routes/clear-up/index.tsx` — halaman Clear Up.
- `tests/clear-up-route.test.ts` — 17 test, gaya scan-source seperti `tests/kasir-route.test.ts`/`tests/satgas-route.test.ts` (konvensi test rute yang sudah dipakai di repo ini), termasuk pengecekan eksplisit bahwa tick `setInterval` untuk durasi tidak pernah memanggil snapshot/invalidateQueries.

**Perilaku halaman:**
1. Guard identitas sama seperti Kasir/Satgas: baca `readRoleSessionIdentity`, kalau kosong/role bukan `clear_up` → redirect ke `/`. Tombol Keluar sama.
2. Grid/list toggle via `useLayoutPreference("clear_up")` (default list, lihat kesenjangan di atas), tema `OwnerUi.tsx` sama seperti Kasir/Satgas.
3. Hanya menampilkan meja yang **sedang TERISI** (bukan grid 100 slot penuh seperti Kasir/Satgas) — diurutkan dari yang paling lama terisi, masing-masing dengan badge durasi yang berjalan lewat tick `setInterval` 1 detik, murni dihitung dari `occupied_at` yang sudah ada di snapshot (tanpa panggilan server tambahan).
4. Tap satu meja → dialog konfirmasi ("Tandai Meja X Sudah Dibersihkan?") → `setTableEmptyCleanup` → invalidate query snapshot pada sukses.
5. Kalau tidak ada meja yang TERISI, tampilkan `OwnerEmpty` alih-alih daftar kosong.

**Hasil:** 600/600 test lulus (568 sebelumnya + 32 baru: 12 logika murni + 17 route + 3 kasus baru di `use-layout-preference.test.ts`), `tsc` bersih, `lint` bersih (setelah `eslint --fix` untuk format prettier di file test baru), `build` bersih.
