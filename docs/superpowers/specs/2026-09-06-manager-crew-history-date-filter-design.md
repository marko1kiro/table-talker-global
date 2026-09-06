# Filter Tanggal — Kartu "Crew Aktif" Dashboard Manager

Tanggal: 6 September 2026
Status: disetujui (design A — satu kartu + switch scope)

## Masalah

Kartu "Crew Aktif" di `/manager` hanya menampilkan crew yang sesinya masih berlaku
(`get_manager_active_crew` via join `role_session_tokens.expires_at > now()`). Manager tidak
bisa melihat riwayat kehadiran crew di tanggal-tanggal lampau.

Sumber data yang tepat sudah tersedia: tabel `crew_role_sessions` adalah audit log
insert-only (tidak pernah dihapus, tanpa job retensi) dengan indeks
`(restaurant_id, role, checked_in_at)` — riwayat per tanggal bisa langsung dikueri tanpa
perubahan skema tabel.

## Keputusan (Approach A)

Satu kartu "Crew Aktif" dengan **switch scope** di atasnya:

- **[Hari ini]** — default saat halaman dibuka (bukan "Semua").
- **[Tanggal]** — tombol yang membuka **kalender modern** (shadcn `ui/calendar.tsx` =
  react-day-picker v9 dalam `ui/popover.tsx`, locale `id`). Pilih tanggal mana pun —
  termasuk bulan-bulan/tahun lampau; data `crew_role_sessions` persist permanen.
- **[Semua]** — riwayat terbaru, dibatasi `LIMIT 300` baris (untuk lebih lama, pilih
  tanggal).

Semua scope membaca satu sumber: RPC baru `get_manager_crew_history`. Jika tanggal yang
dipilih = hari ini (WIB), scope otomatis disimpan sebagai `today`.

## Design

### 1. Database (1 migration baru)

- RPC `get_manager_crew_history(p_manager_token text, p_date date default null)`
  - Validasi token manager identik dengan `get_manager_active_crew` (hash SHA-256,
    `manager_accounts.status = 'aktif'`, `manager_sessions.expires_at > now()`,
    `restaurants.is_active`); scope restaurant diambil dari session, bukan dari klien.
  - Return: `role text, display_name text, checked_in_at timestamptz, is_active boolean`.
  - `is_active` = `exists (select 1 from role_session_tokens rst where
    rst.role_session_id = crs.id and rst.expires_at > now())`.
  - Filter tanggal memakai **batas WIB**:
    `(crs.checked_in_at at time zone 'Asia/Jakarta')::date = p_date`.
  - `p_date null` → semua riwayat, `order by checked_in_at desc limit 300`;
    `p_date` terisi → `limit 500`.
  - `revoke`/`grant execute ... to authenticated` mengikuti pola RPC manager lain.
- `drop function if exists public.get_manager_active_crew(text);` — sepenuhnya digantikan
  RPC baru (satu-satunya pemanggil adalah kartu Crew Aktif).

### 2. Server (`src/lib/manager-dashboard.server.ts`)

- `getManagerCrewHistory` — `createServerFn({ method: "GET" })`, mirror pola
  `getManagerActiveCrew` yang ada.
- Validator: `managerToken`, `accessToken`, `date` opsional `z.string().regex(YYYY-MM-DD)`.
- Row: `{ role, displayName, checkedInAt, isActive }`.
- Fungsi `getManagerActiveCrew` + tipenya dihapus (pemakainya diganti).

### 3. UI (`src/routes/manager/index.tsx`, `src/lib/crew-history-scope.ts`)

- `src/lib/crew-history-scope.ts`:
  - `wibDateKey(date = new Date())` → `YYYY-MM-DD` via
    `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" })`.
  - tipe `CrewScope = { kind: "today" } | { kind: "date"; date: string } | { kind: "all" }`
    + `scopeToParams(scope)` → `{ date?: string }` untuk server fn + `scopeQueryKey(scope)`.
- State `crewScope`, default `{ kind: "today" }`.
- Query: `useQuery` key `["manager-crew-history", restaurantId, scopeQueryKey(scope)]`,
  enabled `menu === "crew"` — ganti scope otomatis refetch (pola react-query yang sama
  dengan query crew lama).
- Switcher di atas daftar: pill segmented **[Hari ini] [kalender 📅 Sen, 6 Sep] [Semua]**;
  Popover + Calendar (`mode="single"`, `locale` id, `defaultMonth` = tanggal terpilih).
- Daftar: grouping per station dipakai ulang (`groupActiveCrewByStation`), urutan dalam
  grup **terbaru dulu**. Baris: nama + jam masuk (`formatWibClock`); `isActive` → badge
  hijau "AKTIF", sisanya redup (`text-ta-gray-400`). Path render desktop + mobile yang
  sudah ada sama-sama memakai data baru.
- Empty state per scope: tanggal → "Belum ada crew check-in di tanggal ini."; Semua →
  "Belum ada riwayat kehadiran."
- Gagal muat: `TaRetry` (pola error kartu lain).

### 4. Testing (TDD, MERAH → HIJAU)

- `tests/crew-history-scope.test.ts` (unit):
  - `wibDateKey`: boundary WIB (mis. `2026-09-06T20:00:00Z` → `"2026-09-07"`).
  - `scopeToParams`: today → `{ date: hari-ini-WIB }`, date → `{ date }`, all → `{}`.
- `tests/manager-crew-history.test.ts` (source assertion):
  - Migration: memuat `get_manager_crew_history`, `Asia/Jakarta`, grant ke
    `authenticated`, dan drop `get_manager_active_crew`.
  - `manager-dashboard.server.ts`: `getManagerCrewHistory` + validator `date`.
  - `manager/index.tsx`: "Hari ini", "Semua", `Popover`, `Calendar`, scope pada query key,
    `crew-history-scope` terimport.
- Update test lama yang mereferensi `getManagerActiveCrew` /
  `get_manager_active_crew`.

### 5. Deployment

- Migration diaplikasikan ke proyek Supabase produksi (`kjzxtmxdbcanvkgqqdow`) via
  `apply_migration`.
- Deploy Vercel mengikuti push `main` (build `npm run verify`).

## Risiko

- Migration additive + 1 drop fungsi yang tergantikan; rollback = recreate fungsi lama.
- Mode "Semua" terbatas 300 baris terbaru (± 2–4 pekan); tanggal lebih lama via kalender.
- Batas tanggal memakai WIB agar konsisten dengan jam operasional resto (bukan UTC server).

## Di luar scope

- Dropdown navigasi bulan/tahun di kalender (tinggal `captionLayout="dropdown"` bila
  diminta nanti).
- Ekspor/unduh riwayat.
