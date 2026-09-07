# Manager Daily Stats + CSV Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add occupancy statistics tab and CSV export to Manager Dashboard.

**Architecture:** DB trigger on `table_occupancy_state` logs every status change to `occupancy_transitions`. New RPC `get_manager_daily_stats` aggregates per-WIB-day. Client-side CSV generation from stats + crew data. New "Statistik" tab in Manager Dashboard with stat cards, per-table breakdown, date picker, and download button.

**Tech Stack:** PostgreSQL (trigger, RPC), TanStack Start server functions, React + TailAdmin components, client-side Blob CSV.

**Spec:** `docs/superpowers/specs/2026-09-07-manager-daily-stats-csv-export-design.md`

---

### Task 1: Migration — `occupancy_transitions` table + trigger + RPC + retention

**Files:**
- Create: `supabase/migrations/20260907120000_manager_daily_stats.sql`
- Create: `tests/occupancy-transitions-migration.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/migrations/20260907120000_manager_daily_stats.sql", import.meta.url),
  "utf8",
);

describe("manager daily stats migration", () => {
  it("creates occupancy_transitions table", () => {
    expect(sql).toContain("create table public.occupancy_transitions");
  });
  it("creates trigger on table_occupancy_state", () => {
    expect(sql).toContain("create or replace function public.log_occupancy_transition");
    expect(sql).toContain("create trigger trg_log_occupancy_transition");
  });
  it("creates get_manager_daily_stats RPC", () => {
    expect(sql).toContain("create or replace function public.get_manager_daily_stats");
  });
  it("creates retention cleanup function and cron", () => {
    expect(sql).toContain("create or replace function public.cleanup_occupancy_transitions");
    expect(sql).toContain("cleanup-occupancy-transitions-daily");
  });
  it("revokes public access on occupancy_transitions", () => {
    expect(sql).toContain("revoke all on public.occupancy_transitions from public, anon, authenticated");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/occupancy-transitions-migration.test.ts`
Expected: FAIL — file does not exist

- [ ] **Step 3: Write migration file**

Create `supabase/migrations/20260907120000_manager_daily_stats.sql`:

```sql
-- Occupancy transitions: trigger-based audit log tracking every
-- KOSONG↔TERISI change on table_occupancy_state.
-- + RPC get_manager_daily_stats for Manager Dashboard "Statistik" tab.
-- + 90-day retention via pg_cron cleanup.

-- 1. Audit table
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

-- 2. Trigger function
create or replace function public.log_occupancy_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.status is distinct from NEW.status then
    insert into public.occupancy_transitions
      (restaurant_id, table_number, old_status, new_status)
    values (NEW.restaurant_id, NEW.table_number, OLD.status, NEW.status);
  end if;
  return NEW;
end;
$$;

create trigger trg_log_occupancy_transition
  after update on public.table_occupancy_state
  for each row
  execute function public.log_occupancy_transition();

-- 3. Manager daily stats RPC
create or replace function public.get_manager_daily_stats(
  p_manager_token text,
  p_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
  v_day date;
  v_result jsonb;
begin
  select ms.restaurant_id into v_restaurant
  from public.manager_sessions ms
  join public.manager_accounts ma on ma.id = ms.manager_id
  join public.restaurants r on r.id = ms.restaurant_id
  where ms.token_hash = encode(extensions.digest(p_manager_token, 'sha256'), 'hex')
    and ma.status = 'aktif'
    and ms.expires_at > now()
    and r.is_active;
  if v_restaurant is null then raise exception 'INVALID_SESSION'; end if;

  v_day := coalesce(p_date, (now() at time zone 'Asia/Jakarta')::date);

  with day_transitions as (
    select table_number, old_status, new_status, transitioned_at
    from public.occupancy_transitions
    where restaurant_id = v_restaurant
      and (transitioned_at at time zone 'Asia/Jakarta')::date = v_day
  ),
  served as (
    select count(*) as total_served
    from day_transitions
    where old_status = 'kosong' and new_status = 'terisi'
  ),
  peak as (
    select extract(hour from transitioned_at at time zone 'Asia/Jakarta')::int as hr
    from day_transitions
    where old_status = 'kosong' and new_status = 'terisi'
    group by hr
    order by count(*) desc
    limit 1
  ),
  paired as (
    select t_in.table_number,
           t_in.transitioned_at as occupied_at,
           (
             select min(t_out.transitioned_at)
             from day_transitions t_out
             where t_out.table_number = t_in.table_number
               and t_out.old_status = 'terisi'
               and t_out.new_status = 'kosong'
               and t_out.transitioned_at > t_in.transitioned_at
           ) as vacated_at
    from day_transitions t_in
    where t_in.old_status = 'kosong' and t_in.new_status = 'terisi'
  ),
  durations as (
    select table_number,
           extract(epoch from vacated_at - occupied_at) / 60.0 as minutes
    from paired
    where vacated_at is not null
  ),
  per_table as (
    select
      g.n as table_number,
      coalesce(occ.times_occupied, 0) as times_occupied,
      coalesce(dur.total_minutes, 0) as total_minutes,
      dur.avg_minutes
    from generate_series(1, 100) g(n)
    left join (
      select table_number, count(*) as times_occupied
      from day_transitions
      where old_status = 'kosong' and new_status = 'terisi'
      group by table_number
    ) occ on occ.table_number = g.n
    left join (
      select table_number,
             round(sum(minutes)::numeric, 1) as total_minutes,
             round(avg(minutes)::numeric, 1) as avg_minutes
      from durations
      group by table_number
    ) dur on dur.table_number = g.n
    order by g.n
  )
  select jsonb_build_object(
    'total_served', (select total_served from served),
    'avg_duration_minutes', (select round(avg(minutes)::numeric, 1) from durations),
    'peak_hour', (select hr from peak),
    'per_table', (select coalesce(jsonb_agg(
      jsonb_build_object(
        'table_number', table_number,
        'times_occupied', times_occupied,
        'total_minutes', total_minutes,
        'avg_minutes', avg_minutes
      ) order by table_number
    ), '[]'::jsonb) from per_table)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_manager_daily_stats(text, date) from public, anon, service_role;
grant execute on function public.get_manager_daily_stats(text, date) to authenticated;

-- 4. Retention: 90 days
create or replace function public.cleanup_occupancy_transitions()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.occupancy_transitions
  where transitioned_at < now() - interval '90 days';
end;
$$;
revoke all on function public.cleanup_occupancy_transitions() from public, anon, authenticated;
grant execute on function public.cleanup_occupancy_transitions() to service_role;

do $$
begin
  create extension if not exists pg_cron;
  if not exists (select 1 from cron.job where jobname = 'cleanup-occupancy-transitions-daily') then
    perform cron.schedule(
      'cleanup-occupancy-transitions-daily',
      '35 3 * * *',
      $cron$select public.cleanup_occupancy_transitions()$cron$
    );
  end if;
exception
  when insufficient_privilege or undefined_file or undefined_function
    or invalid_schema_name or feature_not_supported then null;
end;
$$;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/occupancy-transitions-migration.test.ts`
Expected: 5 passed

- [ ] **Step 5: Apply migration to Supabase prod**

Use `supabase_apply_migration` tool.

- [ ] **Step 6: Commit**

```
git add supabase/migrations/20260907120000_manager_daily_stats.sql tests/occupancy-transitions-migration.test.ts
git commit -m "feat(db): occupancy_transitions table + trigger + daily stats RPC + retention"
```

---

### Task 2: Server function — `getManagerDailyStats`

**Files:**
- Create: `src/lib/manager-stats.server.ts`
- Create: `tests/manager-daily-stats-server.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { getManagerDailyStatsCore } from "../src/lib/manager-stats.server";

describe("getManagerDailyStatsCore", () => {
  it("normalizes RPC result", async () => {
    const rpc = async () => ({
      data: {
        total_served: 12,
        avg_duration_minutes: 23.5,
        peak_hour: 14,
        per_table: [
          { table_number: 1, times_occupied: 3, total_minutes: 70, avg_minutes: 23.3 },
          { table_number: 2, times_occupied: 0, total_minutes: 0, avg_minutes: null },
        ],
      },
      error: null,
    });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalServed).toBe(12);
      expect(r.avgDurationMinutes).toBe(23.5);
      expect(r.peakHour).toBe(14);
      expect(r.perTable[0]).toEqual({
        tableNumber: 1,
        timesOccupied: 3,
        totalMinutes: 70,
        avgMinutes: 23.3,
      });
      expect(r.perTable[1]).toMatchObject({ tableNumber: 2, timesOccupied: 0, avgMinutes: null });
    }
  });

  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("maps generic RPC error", async () => {
    const rpc = async () => ({ data: null, error: { message: "connection timeout" } });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("handles null per_table gracefully", async () => {
    const rpc = async () => ({
      data: {
        total_served: 0,
        avg_duration_minutes: null,
        peak_hour: null,
        per_table: null,
      },
      error: null,
    });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalServed).toBe(0);
      expect(r.perTable).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-daily-stats-server.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write server function**

Create `src/lib/manager-stats.server.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";

const GENERIC = "Gagal memuat statistik.";

export const managerDailyStatsInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type PerTableStat = {
  tableNumber: number;
  timesOccupied: number;
  totalMinutes: number;
  avgMinutes: number | null;
};

export type DailyStatsResult =
  | {
      ok: true;
      totalServed: number;
      avgDurationMinutes: number | null;
      peakHour: number | null;
      perTable: PerTableStat[];
    }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export async function getManagerDailyStatsCore(
  data: { managerToken: string; date: string },
  rpc: RpcCaller,
): Promise<DailyStatsResult> {
  try {
    const { data: raw, error } = await rpc("get_manager_daily_stats", {
      p_manager_token: data.managerToken,
      p_date: data.date,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    const obj = raw as Record<string, unknown> | null;
    if (!obj || typeof obj !== "object") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    }
    const perTableRaw = Array.isArray(obj.per_table) ? obj.per_table : [];
    return {
      ok: true,
      totalServed: typeof obj.total_served === "number" ? obj.total_served : 0,
      avgDurationMinutes:
        typeof obj.avg_duration_minutes === "number" ? obj.avg_duration_minutes : null,
      peakHour: typeof obj.peak_hour === "number" ? obj.peak_hour : null,
      perTable: perTableRaw.map((r: Record<string, unknown>) => ({
        tableNumber: Number(r.table_number),
        timesOccupied: Number(r.times_occupied),
        totalMinutes: Number(r.total_minutes),
        avgMinutes: typeof r.avg_minutes === "number" ? r.avg_minutes : null,
      })),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerDailyStats = createServerFn({ method: "GET" })
  .validator(managerDailyStatsInputSchema)
  .handler(async ({ data }): Promise<DailyStatsResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerDailyStatsCore(
      { managerToken: data.managerToken, date: data.date },
      async (fn, params) => client.rpc(fn, params),
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-daily-stats-server.test.ts`
Expected: 4 passed

- [ ] **Step 5: Prettier + commit**

```
npx prettier --write src/lib/manager-stats.server.ts tests/manager-daily-stats-server.test.ts
git add src/lib/manager-stats.server.ts tests/manager-daily-stats-server.test.ts
git commit -m "feat: getManagerDailyStats server function"
```

---

### Task 3: CSV export — `buildManagerCsv` + `downloadCsv`

**Files:**
- Create: `src/lib/manager-csv-export.ts`
- Create: `tests/manager-csv-export.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildManagerCsv } from "../src/lib/manager-csv-export";
import type { DailyStatsResult, PerTableStat } from "../src/lib/manager-stats.server";
import type { CrewHistoryRow } from "../src/lib/manager-dashboard.server";

const stats: DailyStatsResult & { ok: true } = {
  ok: true,
  totalServed: 5,
  avgDurationMinutes: 18.2,
  peakHour: 12,
  perTable: [
    { tableNumber: 1, timesOccupied: 2, totalMinutes: 36.4, avgMinutes: 18.2 },
    { tableNumber: 2, timesOccupied: 0, totalMinutes: 0, avgMinutes: null },
  ],
};

const crew: CrewHistoryRow[] = [
  { role: "kasir", displayName: "Rina", checkedInAt: "2026-09-07T03:00:00Z", isActive: true },
];

describe("buildManagerCsv", () => {
  it("contains Ringkasan Harian section", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Ringkasan Harian");
  });
  it("contains Occupancy Per Meja section", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Occupancy Per Meja");
  });
  it("contains Crew History section", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Crew History");
  });
  it("includes stat values in ringkasan", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("5");
    expect(csv).toContain("18.2");
    expect(csv).toContain("12:00 WIB");
  });
  it("includes crew row", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Rina");
    expect(csv).toContain("kasir");
  });
  it("handles empty data", () => {
    const empty: DailyStatsResult & { ok: true } = {
      ok: true,
      totalServed: 0,
      avgDurationMinutes: null,
      peakHour: null,
      perTable: [],
    };
    const csv = buildManagerCsv(empty, [], "2026-09-07");
    expect(csv).toContain("Ringkasan Harian");
    expect(csv).toContain("0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-csv-export.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write CSV export module**

Create `src/lib/manager-csv-export.ts`:

```ts
import type { DailyStatsResult, PerTableStat } from "./manager-stats.server";
import type { CrewHistoryRow } from "./manager-dashboard.server";

function peakLabel(hour: number | null): string {
  if (hour === null) return "-";
  return `${String(hour).padStart(2, "0")}:00 WIB`;
}

function avgLabel(min: number | null): string {
  if (min === null) return "-";
  return String(min);
}

export function buildManagerCsv(
  stats: DailyStatsResult & { ok: true },
  crew: CrewHistoryRow[],
  date: string,
): string {
  const lines: string[] = [];

  lines.push("Ringkasan Harian");
  lines.push("Tanggal,Total Tamu Dilayani,Rata-rata Durasi (menit),Peak Hour");
  lines.push(
    `${date},${stats.totalServed},${avgLabel(stats.avgDurationMinutes)},${peakLabel(stats.peakHour)}`,
  );
  lines.push("");

  lines.push("Occupancy Per Meja");
  lines.push("No Meja,Kali Terisi,Total Durasi (menit),Avg Durasi (menit)");
  for (const t of stats.perTable) {
    lines.push(
      `${t.tableNumber},${t.timesOccupied},${t.totalMinutes},${avgLabel(t.avgMinutes)}`,
    );
  }
  lines.push("");

  lines.push("Crew History");
  lines.push("Role,Nama,Jam Masuk,Status");
  for (const c of crew) {
    lines.push(`${c.role},${c.displayName},${c.checkedInAt},${c.isActive ? "Aktif" : "Tidak Aktif"}`);
  }

  return lines.join("\n");
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-csv-export.test.ts`
Expected: 6 passed

- [ ] **Step 5: Prettier + commit**

```
npx prettier --write src/lib/manager-csv-export.ts tests/manager-csv-export.test.ts
git add src/lib/manager-csv-export.ts tests/manager-csv-export.test.ts
git commit -m "feat: CSV export buildManagerCsv + downloadCsv"
```

---

### Task 4: UI — "Statistik" tab in Manager Dashboard

**Files:**
- Modify: `src/components/ManagerLayout.tsx` (add `"stats"` to `ManagerMenu`, add nav item)
- Modify: `src/routes/manager/index.tsx` (add stats tab UI, queries, CSV button)
- Create: `tests/manager-stats-tab.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync(
  new URL("../src/components/ManagerLayout.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../src/routes/manager/index.tsx", import.meta.url),
  "utf8",
);

describe("manager stats tab", () => {
  it("ManagerMenu type includes stats", () => {
    expect(layout).toContain('"stats"');
  });
  it("layout has Statistik label", () => {
    expect(layout).toContain("STATISTIK");
  });
  it("layout imports BarChart3", () => {
    expect(layout).toContain("BarChart3");
  });
  it("page imports getManagerDailyStats", () => {
    expect(page).toContain("getManagerDailyStats");
  });
  it("page imports buildManagerCsv", () => {
    expect(page).toContain("buildManagerCsv");
  });
  it("page imports downloadCsv", () => {
    expect(page).toContain("downloadCsv");
  });
  it("page has Download Laporan CSV button text", () => {
    expect(page).toContain("Download Laporan CSV");
  });
  it("page has manager-daily-stats query key", () => {
    expect(page).toContain("manager-daily-stats");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-stats-tab.test.ts`
Expected: FAIL — assertions fail

- [ ] **Step 3: Update ManagerLayout**

Modify `src/components/ManagerLayout.tsx`:

Change `ManagerMenu` type to: `"tables" | "crew" | "log" | "stats"`

Add `BarChart3` to lucide-react import.

Add to `ICONS`: `stats: BarChart3`

Add to `LABELS` array: `{ id: "stats", label: "STATISTIK" }`

- [ ] **Step 4: Update manager/index.tsx — imports and queries**

Add imports at top of `src/routes/manager/index.tsx`:
```ts
import { Download } from "lucide-react";
import { getManagerDailyStats } from "@/lib/manager-stats.server";
import { buildManagerCsv, downloadCsv } from "@/lib/manager-csv-export";
```

Add stats query after `crew` query:
```ts
const [statsScope, setStatsScope] = useState<CrewScope>({ kind: "today" });
const [statsCalOpen, setStatsCalOpen] = useState(false);

const stats = useQuery({
  queryKey: ["manager-daily-stats", restaurantId, scopeQueryKey(statsScope)],
  queryFn: async () =>
    getManagerDailyStats({
      data: {
        managerToken: identity!.managerToken,
        accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        date: scopeToParams(statsScope).date ?? wibDateKey(),
      },
    }),
  enabled: Boolean(identity) && menu === "stats",
  placeholderData: keepPreviousData,
});

const statsCrew = useQuery({
  queryKey: ["manager-crew-history", restaurantId, scopeQueryKey(statsScope)],
  queryFn: async () =>
    getManagerCrewHistory({
      data: {
        managerToken: identity!.managerToken,
        accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        ...scopeToParams(statsScope),
      },
    }),
  enabled: Boolean(identity) && menu === "stats",
  placeholderData: keepPreviousData,
});
```

Also update crew query `enabled` — keep `menu === "crew"` (crew for crew tab stays separate; stats tab has its own crew query scoped to stats date).

- [ ] **Step 5: Update manager/index.tsx — stats tab JSX**

Add before the closing `</ManagerLayout>`, after the `menu === "log"` block:

```tsx
{menu === "stats" && (
  <>
    <TaCard title="Statistik Harian">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setStatsScope({ kind: "today" })}
          className={crewScopePillClass(statsScope.kind === "today")}
        >
          Hari ini
        </button>
        <Popover open={statsCalOpen} onOpenChange={setStatsCalOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={crewScopePillClass(statsScope.kind === "date")}
            >
              <CalendarDays className="size-3.5" />
              {statsScope.kind === "date" ? formatScopeDate(statsScope.date) : "Pilih tanggal"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={localeId}
              selected={
                statsScope.kind === "date"
                  ? parseISO(statsScope.date)
                  : statsScope.kind === "today"
                    ? parseISO(wibDateKey())
                    : undefined
              }
              defaultMonth={statsScope.kind === "date" ? parseISO(statsScope.date) : undefined}
              onSelect={(d) => {
                if (!d) return;
                const key = wibDateKey(d);
                setStatsCalOpen(false);
                setStatsScope(
                  key === wibDateKey() ? { kind: "today" } : { kind: "date", date: key },
                );
              }}
            />
          </PopoverContent>
        </Popover>
      </div>

      {(stats.isLoading || stats.isFetching) && (
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">Memuat statistik...</p>
      )}
      {stats.isError && (
        <TaRetry label="Gagal memuat statistik" onClick={() => void stats.refetch()} />
      )}

      {stats.data && stats.data.ok && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <TaStatCard label="Total Tamu" value={stats.data.totalServed} compact />
            <TaStatCard
              label="Avg Durasi"
              value={
                stats.data.avgDurationMinutes !== null
                  ? `${Math.floor(stats.data.avgDurationMinutes)}m`
                  : "-"
              }
              compact
            />
            <TaStatCard
              label="Peak Hour"
              value={
                stats.data.peakHour !== null
                  ? `${String(stats.data.peakHour).padStart(2, "0")}:00`
                  : "-"
              }
              compact
            />
            <TaStatCard
              label="Crew Aktif"
              value={
                statsCrew.data && statsCrew.data.ok
                  ? statsCrew.data.crew.filter((c) => c.isActive).length
                  : "-"
              }
              compact
            />
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-[11px] uppercase text-ta-gray-400">
                  <th className="border border-black/10 px-3 py-1 text-center">No. Meja</th>
                  <th className="border border-black/10 px-3 py-1 text-center">Kali Terisi</th>
                  <th className="border border-black/10 px-3 py-1 text-center">Total Durasi</th>
                  <th className="border border-black/10 px-3 py-1 text-center">Avg Durasi</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.perTable.map((t) => (
                  <tr
                    key={t.tableNumber}
                    className={
                      t.timesOccupied === 0
                        ? "text-ta-gray-300 dark:text-ta-gray-600"
                        : "text-ta-gray-800 dark:text-ta-gray-100"
                    }
                  >
                    <td className="border border-black/10 px-3 py-2 text-center font-bold">
                      {t.tableNumber}
                    </td>
                    <td className="border border-black/10 px-3 py-2 text-center">
                      {t.timesOccupied}
                    </td>
                    <td className="border border-black/10 px-3 py-2 text-center">
                      {t.totalMinutes > 0 ? `${t.totalMinutes}m` : "-"}
                    </td>
                    <td className="border border-black/10 px-3 py-2 text-center">
                      {t.avgMinutes !== null ? `${t.avgMinutes}m` : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={!stats.data || !stats.data.ok}
            onClick={() => {
              if (!stats.data?.ok) return;
              const crewRows =
                statsCrew.data && statsCrew.data.ok ? statsCrew.data.crew : [];
              const dateKey = scopeToParams(statsScope).date ?? wibDateKey();
              const csv = buildManagerCsv(stats.data, crewRows, dateKey);
              downloadCsv(
                csv,
                `LIME-statistik-${identity.restaurantDisplayName.replace(/\s+/g, "-")}-${dateKey}.csv`,
              );
            }}
            className="mt-4 inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-theme-sm transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:pointer-events-none disabled:opacity-45"
          >
            <Download className="size-4" />
            Download Laporan CSV
          </button>
        </>
      )}
    </TaCard>
  </>
)}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/manager-stats-tab.test.ts`
Expected: 8 passed

- [ ] **Step 7: Prettier + tsc + commit**

```
npx prettier --write src/components/ManagerLayout.tsx src/routes/manager/index.tsx tests/manager-stats-tab.test.ts
npx tsc --noEmit
git add src/components/ManagerLayout.tsx src/routes/manager/index.tsx tests/manager-stats-tab.test.ts
git commit -m "feat: Statistik tab in Manager Dashboard with CSV export"
```

---

### Task 5: Full verification

- [ ] **Step 1: Run full verify**

Run: `npm run verify`
Expected: All tests pass, tsc clean, lint clean, build clean, exit 0.

- [ ] **Step 2: Fix any issues found**

If verify fails, fix issues and re-run.

- [ ] **Step 3: Final commit if any fixes needed**

Only if Step 2 required changes.
