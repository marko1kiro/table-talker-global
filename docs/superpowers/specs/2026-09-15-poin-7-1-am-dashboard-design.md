# Poin 7.1 — Dashboard Area Manager: lifecycle data per resto

Tanggal: 2026-09-15. Status: APPROVED pemilik (brainstorming Q1–Q10).

## 1. Latar

Dashboard AM hari ini satu halaman (`src/routes/am/index.tsx`, 516 baris, 1 nav item)
dengan 5 kartu menumpuk. AM tak bisa pantau putaran meja antar-resto secara
realtime — fungsi inti perannya. Data manager/audit digabung lintas resto.

## 2. Pecah gelombang (keputusan pemilik)

- **7.1a (tanpa migration):** routing + sidebar + tab-switch + pindahkan menu
  Manager Resto, Password Request (+riwayat), Audit (+filter resto). Stub jujur
  untuk Meja/Statistik/Leaderboard. NOL migration, NOL RPC baru, NOL sentuh sesi.
- **7.1b (1 migration):** RPC scope-AM meja/stats/leaderboard + realtime
  multi-resto + grafik recharts + isi ketiga stub.

## 3. Routing + sidebar (7.1a, pendekatan A)

Route TanStack per menu, guard `getAmStatus` dipakai ulang per route:

| Route | Isi 7.1a | Isi 7.1b |
|---|---|---|
| `/am` | Ringkas scope + kartu navigasi | tetap |
| `/am/meja` | Stub "Segera hadir" | Kartu resto → grid meja read-only realtime |
| `/am/statistik` | Stub | Kartu + grafik tren + tabel per-meja |
| `/am/leaderboard` | Stub | Ranking + filter tanggal |
| `/am/manager` | Tabel + tambah (pindah utuh) | tetap |
| `/am/password` | Pending + riwayat (seksi 6) | tetap |
| `/am/audit` | Audit + filter resto (seksi 6) | tetap |

Sidebar `AppShell` 7 item dengan ikon lucide, active dari route. `/am/forgot.tsx`
tidak berubah.

## 4. Tab-switch resto + ingat pilihan

- Komponen `AmRestoTabs` dipakai di 6 menu (termasuk password — keputusan pemilik:
  jangan digabung).
- Pilihan tersimpan per menu di `localStorage lm.am.resto.v1` (kunci per menu;
  AM boleh pantau meja resto A sambil lihat statistik resto B).
- Default: 7.1a = resto pertama scope (jujur: data "paling aktif" belum ada);
  7.1b = okupansi terisi terbanyak dari snapshot (alasan: login AM random waktu,
  tamu-harian basi di luar jam ramai).

## 5. Status Meja realtime (7.1b, satu-satunya migration)

1 migration, ADDITIVE ONLY, pola grant ikut RPC AM existing
(`revoke public,anon,authenticated` + `grant service_role`):

- `am_table_snapshot(p_am_id, p_restaurant_id)` — snapshot okupansi 1 resto,
  cek assignment AM dalam body via `actor_can_manage_restaurant`.
- `am_table_stats(p_am_id, p_restaurant_id, p_date)` — agregat harian dari
  `occupancy_transitions` (pola `get_manager_daily_stats`).
- `am_leaderboard(p_am_id, p_from, p_to)` — tamu per resto dalam scope + range.
- `bind_am_table_realtime(p_am_id, p_restaurant_id)` — bind channel
  `table-occupancy:{resto}` untuk JWT carrier AM.

UI: kartu per resto (terisi/kosong) → klik → grid meja gaya manager TANPA tombol
aksi. Satu channel per resto aktif; unsubscribe saat pindah tab.

**READ-ONLY absolut:** AM dilarang ubah status meja resto apa pun. Guard test:
grep-lock nol import modul mutasi okupansi (`table-occupancy.server`,
`set_table_*`) di route/komponen AM.

**Crew aktif aman (syarat pemilik):** migration aditif; nol ubah RPC
crew/manager existing; nol emit broadcast baru; channel broadcast existing hanya
dibaca. Crew yang sedang login tidak terdampak.

## 6. Statistik + Leaderboard (7.1b)

- Statistik per resto (tab): kartu total served / peak hour / okupansi kini +
  grafik tren harian (recharts ^2.15.4 sudah di `package.json`, wrapper
  `src/components/ui/chart.tsx` ada, nol pemakaian — tanpa dep baru) + tabel
  per-meja.
- Leaderboard halaman sendiri (`/am/leaderboard`): ranking resto scope by tamu
  terbanyak; filter Hari ini / Kemarin / 7 hari / 30 hari / custom range.

## 7. Manager Resto (7.1a)

Pindah tabel + `CreateManagerCard` utuh ke `/am/manager`. Tambah tab resto
(filter client — `restaurant_id` sudah di tiap baris `AmManagerRow`). Form tambah
di ATAS tabel; resto default form = tab aktif. Nol ubah RPC/mutasi.

## 8. Password Request + Audit (7.1a)

- `/am/password`: pending pindah utuh + tab resto + seksi Riwayat Keputusan.
  Sumber riwayat = `amAudit` existing (filter `manager_reset.decide`), tanpa RPC
  baru. Isi riwayat: aksi + hasil + alasan + waktu (tanpa password — audit log
  memang tak simpan password).
- `/am/audit`: pindah utuh + tab resto + pagination 20/baris anti-scroll-panjang.
  Filter resto client-side. Batasan jujur: baris `restaurant_id NULL` tak tampil
  (batasan `list_admin_audit_for_actor` existing, bukan bug baru).

## 9. Testing

- 7.1a: test tab-switch + persistensi + filter client + riwayat dari audit +
  guard nol-import-mutasi + guard nol-migration (lock file migration).
- 7.1b: test RPC scope (AM tak bisa baca resto luar scope), realtime bind,
  read-only grep-lock, statistik/leaderboard agregat.

## 10. Non-tujuan

- Tanpa ubah alur login/sesi AM, manager, crew, SA.
- Tanpa ubah RPC crew/manager existing.
- Tanpa dep baru (recharts sudah ada).
