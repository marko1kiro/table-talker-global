# Breakdown Task 13 — Manager Dashboard Data-Contract Verification

- **Repo/branch:** `marko1kiro/table-talker-global` @ `main` (setelah commit `a299c2e`, Task 12)
- **Rencana acuan:** `docs/superpowers/plans/2026-08-29-table-occupancy-tracking.md`, bagian "Task 13: Manager Dashboard Data-Contract Verification (no UI)"
- **Dokumen desain terkait:** `docs/superpowers/specs/2026-08-29-table-occupancy-tracking-design.md`, "Open Decisions" #4

## Ringkasan Eksekutif

Task ini murni verifikasi read-only ke database live (`kjzxtmxdbcanvkgqqdow`) — **tidak ada kode/route/migrasi**. Tujuannya: pastikan tabel `table_occupancy_state` dan `crew_role_sessions` (dibangun Task 5, dipakai Task 6-12) cukup untuk dua kebutuhan data Manager Dashboard (Phase 2, belum dibangun):

1. Jumlah meja Kosong/Terisi real-time per resto.
2. Daftar audit shift (Nama + jam masuk) per resto.

**Hasil: keduanya cukup, tidak ada gap skema.** Ditemukan satu detail implementasi penting untuk RPC Phase 2 nanti (bukan gap, bukan perlu migrasi) — dijelaskan di bawah.

## Verifikasi 1 — Skema kolom (live, `information_schema.columns`)

Dikonfirmasi persis sama dengan dokumen desain untuk kedua tabel: `table_occupancy_state` (`restaurant_id`, `table_number`, `status`, `occupied_at`, `occupied_source`, `updated_at`) dan `crew_role_sessions` (`id`, `restaurant_id`, `role`, `display_name`, `checked_in_at`, `created_at`). Token sesi (`session_token_hash` di teks desain) nyatanya disimpan di tabel terpisah `role_session_tokens` — pola yang sama dengan `crew_sessions`/`crew_session_tokens` — tidak relevan untuk dua query verifikasi ini (yang hanya butuh data, bukan otentikasi baris).

## Verifikasi 2 — Live Kosong/Terisi counts per restoran

**Temuan penting:** `table_occupancy_state` **jarang** (sparse) — hanya punya baris untuk `(restaurant_id, table_number)` yang **pernah** mengalami transisi status. Dikonfirmasi langsung: satu resto sampel (`33916a05-...`) yang sudah dipakai testing Kasir/Satgas/Clear Up hanya punya **3 baris**, semuanya `status = 'kosong'` (sisa dari siklus terisi→kosong sebelumnya — baris **tidak dihapus** saat Clear Up menandai kosong, cuma statusnya diubah balik).

Akibatnya: query naif `select status, count(*) from table_occupancy_state where restaurant_id = $1 group by status` akan **salah** — meja yang belum pernah tersentuh (default KOSONG) tidak akan terhitung sama sekali, sehingga jumlah "Kosong" jadi under-count.

Query yang benar sudah ada dan sudah teruji sejak Task 6 — RPC `get_table_occupancy_snapshot` memakai pola `generate_series(1, 100)` LEFT JOIN persis untuk masalah ini:
```sql
select
  gs.table_number,
  coalesce(tos.status, 'kosong') as status,
  tos.occupied_at,
  tos.occupied_source
from generate_series(1, 100) as gs(table_number)
left join public.table_occupancy_state tos
  on tos.restaurant_id = p_restaurant_id and tos.table_number = gs.table_number
order by gs.table_number;
```
Untuk sekadar hitungan (bukan daftar per meja), cukup `group by 1` di atas `coalesce(...)`. **Kesimpulan: cukup, tidak ada kolom/tabel baru — RPC Phase 2 untuk Manager Dashboard tinggal reuse pola ini** (bukan menemukan pola baru).

Catatan tambahan: tidak ada kolom "jumlah meja resto" di tabel `restaurants` (dicek: hanya `esb_app_id` yang cocok pola `%table%`/`%esb%`) — angka `100` sengaja hardcode di RPC yang sudah ada (dan di constraint `check 1..100` skema), bukan per-resto. Ini konvensi yang **sudah ada sejak Task 6**, bukan temuan baru Task 13 — dicatat di sini murni supaya RPC Manager Dashboard nanti tidak mencoba membaca kolom yang tidak ada.

## Verifikasi 3 — Shift audit list (Nama + jam masuk) per restoran

`claim_role_session` (Task 6) **insert-only** — satu baris baru per login, tidak pernah di-update/ditimpa (dikonfirmasi lewat `pg_get_functiondef`: badan fungsi hanya punya satu `insert into crew_role_sessions ... returning * into result`, tidak ada `on conflict`/`update`). Dikonfirmasi live: resto sampel yang sama punya 4 baris berbeda lintas 3 role/login (`clear_up`, `kasir` x2, `satgas`), masing-masing dengan `display_name` dan `checked_in_at` sendiri.

Query:
```sql
select display_name, role, checked_in_at
from crew_role_sessions
where restaurant_id = $1
order by checked_in_at desc;
```
**Kesimpulan: cukup apa adanya, tidak ada gap.**

## Verifikasi 4 — Jalur akses (RLS)

Dicek `pg_tables`/`pg_policies` live: kedua tabel punya `rowsecurity = true` dan **nol policy terdaftar** — artinya hanya `service_role` yang bisa baca langsung; `anon`/`authenticated` akan selalu mendapat 0 baris kalau query langsung ke tabel ini dari klien. Ini **konsisten** dengan konvensi tenant-isolation yang sudah dipakai di seluruh fitur ini (RLS aktif, service-role-only kecuali lewat RPC `security definer` yang eksplisit) — sama seperti `get_table_occupancy_snapshot`, `set_table_occupied_kasir`, dst.

**Implikasi untuk Phase 2 (dicatat, bukan dikerjakan sekarang):** RPC Manager Dashboard nanti wajib berbentuk `security definer` yang memvalidasi sesi manager di-scope ke `restaurant_id` yang diminta (pola sama seperti `get_table_occupancy_snapshot` mengecek `role_session_tokens`), **tidak boleh** cuma `select` langsung dari klien. Ini bukan keputusan baru — cuma konfirmasi bahwa posisi yang sudah dijelaskan di seksi desain "Manager auth tier (Phase 2, contract only)" memang berlaku sungguhan di skema live, bukan cuma di teks.

## Kesimpulan Task 13

- Tidak ada gap skema. Open Decision 4 di dokumen desain ditutup dengan catatan lengkap (lihat file desain, seksi Open Decisions #4).
- Tidak ada migrasi, tidak ada kode, tidak ada test baru — sesuai definisi Task 13 di dokumen rencana (verifikasi murni).
- Checklist Task 13 di dokumen rencana ditandai selesai.
- Tidak ada perubahan yang memengaruhi Kasir/Satgas/Clear Up yang sudah ada — full test suite (600/600) tetap dijalankan ulang sebelum push sebagai sanity check standar proyek ini, meski perubahan kali ini hanya dokumentasi.
