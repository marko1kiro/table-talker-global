# Manager Daily Stats + CSV Export — Design Spec

**Date:** 2026-09-07
**Status:** Approved

## Summary

Add a "Statistik" tab to the Manager Dashboard showing daily occupancy statistics (total tamu dilayani, avg durasi meja terisi, peak hour, per-table breakdown) plus a CSV download covering all data (occupancy per meja, crew history, ringkasan harian) with a date picker.

## Decisions

| Question | Answer |
|----------|--------|
| Metrik | Occupancy rate + durasi (butuh tabel baru) |
| Scope statistik display | Hari ini only |
| Export format | CSV (client-side, zero dependencies) |
| Data di CSV | Semua (occupancy per meja + crew + ringkasan) |
| CSV scope waktu | Pilih tanggal (date picker) |
| UI placement | Tab baru "Statistik" di Manager Dashboard |
| Tracking approach | Trigger-based audit log on `table_occupancy_state` |

## 1. Database

### 1.1 Table: `occupancy_transitions`

```sql
create table public.occupancy_transitions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_number integer not null check (table_number between 1 and 100),
  old_status text not null check (old_status in ('kosong','terisi')),
  new_status text not null check (new_status in ('kosong','terisi')),
  transitioned_at timestamptz not null default now()
);

create index occupancy_transitions_restaurant_day_idx
  on public.occupancy_transitions (restaurant_id, transitioned_at desc);

alter table public.occupancy_transitions enable row level security;
revoke all on public.occupancy_transitions from public, anon, authenticated;
```

### 1.2 Trigger on `table_occupancy_state`

AFTER UPDATE trigger: if `OLD.status != NEW.status`, insert one row into `occupancy_transitions` with `old_status = OLD.status`, `new_status = NEW.status`, `transitioned_at = now()`.

### 1.3 RPC: `get_manager_daily_stats(p_manager_token, p_date)`

- Validate manager session (same pattern as `get_manager_crew_history`).
- Query `occupancy_transitions` within WIB date boundary for the manager's restaurant.
- Return JSON object:
  - `total_served` — count of `kosong→terisi` transitions
  - `avg_duration_minutes` — average duration of terisi periods (computed from paired `kosong→terisi` then `terisi→kosong` transitions per table; open sessions with no closing transition are excluded from the average)
  - `peak_hour` — WIB hour (0-23) with most `kosong→terisi` transitions; null if no data
  - `per_table` — array of `{table_number, times_occupied, total_minutes, avg_minutes}`

### 1.4 Retention

90-day retention on `occupancy_transitions`. Add to existing cron cleanup pattern:
```sql
delete from public.occupancy_transitions where transitioned_at < now() - interval '90 days';
```

## 2. Server Layer

### 2.1 `src/lib/manager-stats.server.ts`

- `managerDailyStatsInputSchema` — `{ managerToken: string, accessToken: string, date: YYYY-MM-DD }`
- `getManagerDailyStatsCore(data, rpc)` — calls RPC, normalizes result
- `getManagerDailyStats` — `createServerFn` wrapper

Types:
```ts
type PerTableStat = {
  tableNumber: number;
  timesOccupied: number;
  totalMinutes: number;
  avgMinutes: number | null;
};

type DailyStatsResult =
  | { ok: true; totalServed: number; avgDurationMinutes: number | null;
      peakHour: number | null; perTable: PerTableStat[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };
```

### 2.2 `src/lib/manager-csv-export.ts` (client-side, pure)

- `buildManagerCsv(stats, crew, date): string` — 3 sections:
  1. `## Ringkasan Harian` — total served, avg durasi, peak hour
  2. `## Occupancy Per Meja` — table_number, times_occupied, total_minutes, avg_minutes
  3. `## Crew History` — role, display_name, checked_in_at, is_active
- `downloadCsv(content, filename): void` — Blob + anchor click
- Filename: `LIME-statistik-{resto_name}-{date}.csv`
- Zero external dependencies.

## 3. UI — Tab "Statistik"

### 3.1 Menu Extension

- `ManagerMenu` type: add `"stats"` variant
- Icon: `BarChart3` (lucide-react)
- Label: "Statistik"

### 3.2 Layout

1. **Date picker** — pill switcher `[Hari ini]` + `[Calendar popover]`. Reuse `CrewScope` type and `crew-history-scope.ts` utilities (scope applied to stats query and CSV export).
2. **Stat cards** (4x `TaStatCard`):
   - Total Tamu Dilayani (`totalServed`)
   - Rata-rata Durasi (`avgDurationMinutes` → `Xj Ym` format)
   - Peak Hour (`peakHour` → `"14:00 WIB"`)
   - Jumlah Crew Aktif (count `isActive` from crew query)
3. **Occupancy table** — HTML table with TailAdmin styling. Columns: No. Meja | Kali Terisi | Total Durasi | Avg Durasi. Rows with 0 occupancy shown grayed out.
4. **CSV download button** — below stat cards. Icon `Download` + "Download Laporan CSV". Disabled while data loading.

### 3.3 Query

- Key: `["manager-daily-stats", restaurantId, scopeQueryKey(scope)]`
- `enabled: Boolean(identity) && menu === "stats"`
- `placeholderData: keepPreviousData`
- Crew query also enabled when `menu === "stats"` (for CSV).

### 3.4 Error/Loading

- `TaRetry` on error, `isFetching` loading indicator. Same pattern as crew tab.
- Dark mode: existing TailAdmin dark classes, no custom styling.

## 4. Testing

All tests use source-assertion pattern (readFileSync + toContain), no jsdom.

| Test file | What it tests |
|-----------|---------------|
| `tests/manager-daily-stats-server.test.ts` | `getManagerDailyStatsCore`: success, error, INVALID_SESSION |
| `tests/manager-csv-export.test.ts` | `buildManagerCsv`: section headers, row count, empty data |
| `tests/manager-stats-tab.test.ts` | Source assertions on `manager/index.tsx`: stats menu, imports, stat cards, CSV button, BarChart3 |
| `tests/occupancy-transitions-migration.test.ts` | Source assertions on migration: table, trigger, RPC, retention |

## Out of Scope

- Date range picker (single date only)
- Sorting/filtering the per-table breakdown
- PDF/Excel export
- Backfilling historical data (trigger captures data from deployment forward only)
