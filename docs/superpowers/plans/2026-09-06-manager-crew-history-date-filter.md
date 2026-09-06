# Filter Tanggal Riwayat "Crew Aktif" Manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartu "Crew Aktif" dashboard Manager dapat switch scope (Hari ini [default] / tanggal via kalender / Semua) yang menarik riwayat check-in crew dari DB.

**Architecture:** RPC baru `get_manager_crew_history` membaca audit log `crew_role_sessions` (batas tanggal WIB, flag `is_active` dari `role_session_tokens`); RPC lama `get_manager_active_crew` di-drop. Server fn TanStack baru + lib pure `crew-history-scope.ts` + switcher UI (shadcn Popover + Calendar, locale `id`). Query react-query memakai scope di key → ganti scope = refetch otomatis.

**Tech Stack:** Postgres/Supabase RPC, TanStack Start server fn, @tanstack/react-query, react-day-picker v9 (`ui/calendar.tsx`), Radix Popover (`ui/popover.tsx`), date-fns v4 (locale `id`), Vitest (unit + source assertion, tanpa jsdom).

**Spec:** `docs/superpowers/specs/2026-09-06-manager-crew-history-date-filter-design.md`

**Konvensi:** jalankan `npx prettier --write <file>` setelah setiap edit; test satu file = `npx vitest run tests/<file>`; gate penuh = `npm run verify` (exit 0).

---

### Task 1: Lib pure `crew-history-scope.ts` (unit MERAH → HIJAU)

**Files:**
- Create: `tests/crew-history-scope.test.ts`
- Create: `src/lib/crew-history-scope.ts`

- [ ] **Step 1: Tulis test gagal**

`tests/crew-history-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  crewEmptyText,
  formatScopeDate,
  scopeQueryKey,
  scopeToParams,
  wibDateKey,
  type CrewScope,
} from "../src/lib/crew-history-scope";

describe("wibDateKey", () => {
  it("formats an instant as the WIB calendar date (UTC+7)", () => {
    expect(wibDateKey(new Date("2026-09-06T16:59:00Z"))).toBe("2026-09-06"); // 23:59 WIB
    expect(wibDateKey(new Date("2026-09-06T17:00:00Z"))).toBe("2026-09-07"); // 00:00 WIB
  });
});

describe("scopeToParams", () => {
  it("maps each scope to server params", () => {
    expect(scopeToParams({ kind: "today" })).toEqual({ date: wibDateKey() });
    expect(scopeToParams({ kind: "date", date: "2026-08-01" })).toEqual({
      date: "2026-08-01",
    });
    expect(scopeToParams({ kind: "all" })).toEqual({});
  });
});

describe("scopeQueryKey", () => {
  it("keys today by the live WIB date so it refetches after midnight", () => {
    expect(scopeQueryKey({ kind: "today" })).toBe(wibDateKey());
    expect(scopeQueryKey({ kind: "date", date: "2026-08-01" })).toBe("2026-08-01");
    expect(scopeQueryKey({ kind: "all" })).toBe("all");
  });
});

describe("formatScopeDate", () => {
  it("formats a YYYY-MM-DD key in Indonesian", () => {
    expect(formatScopeDate("2026-09-06")).toBe("Min, 6 Sep 2026");
  });
});

describe("crewEmptyText", () => {
  it("returns a scope-aware empty message", () => {
    expect(crewEmptyText({ kind: "today" })).toBe("Belum ada crew yang check-in hari ini.");
    expect(crewEmptyText({ kind: "date", date: "2026-08-01" })).toBe(
      "Belum ada crew check-in di tanggal ini.",
    );
    expect(crewEmptyText({ kind: "all" })).toBe("Belum ada riwayat kehadiran.");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/crew-history-scope.test.ts`
Expected: FAIL — modul `crew-history-scope` belum ada.

- [ ] **Step 3: Implementasi**

`src/lib/crew-history-scope.ts`:

```ts
import { format, parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";

export type CrewScope =
  | { kind: "today" }
  | { kind: "date"; date: string }
  | { kind: "all" };

export function wibDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

export function scopeToParams(scope: CrewScope): { date?: string } {
  if (scope.kind === "all") return {};
  if (scope.kind === "date") return { date: scope.date };
  return { date: wibDateKey() };
}

export function scopeQueryKey(scope: CrewScope): string {
  if (scope.kind === "date") return scope.date;
  return scope.kind === "all" ? "all" : wibDateKey();
}

export function formatScopeDate(date: string): string {
  return format(parseISO(date), "EEE, d MMM yyyy", { locale: localeId });
}

export function crewEmptyText(scope: CrewScope): string {
  if (scope.kind === "all") return "Belum ada riwayat kehadiran.";
  if (scope.kind === "date") return "Belum ada crew check-in di tanggal ini.";
  return "Belum ada crew yang check-in hari ini.";
}
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `npx prettier --write src/lib/crew-history-scope.ts tests/crew-history-scope.test.ts`
Run: `npx vitest run tests/crew-history-scope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/crew-history-scope.ts tests/crew-history-scope.test.ts
git commit -m "feat(manager): lib scope riwayat crew (WIB date key + mapping)"
```

---

### Task 2: Migration + server fn + tipe + query swap

**Files:**
- Create: `supabase/migrations/20260906120000_manager_crew_history.sql`
- Modify: `src/lib/manager-dashboard.server.ts` (hapus `getManagerActiveCrew` dkk, tambah `getManagerCrewHistory`)
- Modify: `src/lib/manager-crew-groups.ts` (ganti tipe row)
- Modify: `tests/manager-crew-groups.test.ts` (fixture ikut tipe baru)
- Modify: `src/routes/manager/index.tsx` (query swap; UI switcher menyusul di Task 3)
- Create: `tests/manager-crew-history.test.ts`

- [ ] **Step 1: Tulis test gagal**

`tests/manager-crew-history.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("manager crew history", () => {
  it("menambahkan RPC get_manager_crew_history dan men-drop RPC lama", () => {
    const migrations = readdirSync(new URL("../supabase/migrations/", import.meta.url));
    const file = migrations.find((f) => f.includes("manager_crew_history"));
    expect(file).toBeDefined();
    const sql = read(`../supabase/migrations/${file}`);
    expect(sql).toContain("get_manager_crew_history");
    expect(sql).toContain("'Asia/Jakarta'");
    expect(sql).toContain(
      "grant execute on function public.get_manager_crew_history(text, date) to authenticated",
    );
    expect(sql).toContain("drop function if exists public.get_manager_active_crew(text)");
  });

  it("menyediakan server fn getManagerCrewHistory dengan validator tanggal", () => {
    const server = read("../src/lib/manager-dashboard.server.ts");
    expect(server).toContain("getManagerCrewHistory");
    expect(server).toContain("p_date");
    expect(server).toMatch(/date:\s*z\.string\(\)\.regex\(/);
    expect(server).toContain("isActive");
    expect(server).not.toContain("getManagerActiveCrew");
  });

  it("menu crew memakai query riwayat ber-scope", () => {
    const page = read("../src/routes/manager/index.tsx");
    expect(page).toContain("getManagerCrewHistory");
    expect(page).toContain("manager-crew-history");
    expect(page).toContain("crew-history-scope");
    expect(page).not.toContain("getManagerActiveCrew");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/manager-crew-history.test.ts`
Expected: FAIL (migration + server fn + query swap belum ada).

- [ ] **Step 3: Migration**

`supabase/migrations/20260906120000_manager_crew_history.sql`:

```sql
-- Manager read: riwayat check-in crew per tanggal WIB (atau terbatas terbaru
-- saat p_date null), plus flag is_active dari role_session_tokens yang masih
-- berlaku. Sumber: crew_role_sessions (audit log insert-only).
create or replace function public.get_manager_crew_history(
  p_manager_token text,
  p_date date default null
)
returns table (role text, display_name text, checked_in_at timestamptz, is_active boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_restaurant uuid;
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

  return query
  select crs.role,
         crs.display_name,
         crs.checked_in_at,
         exists (
           select 1 from public.role_session_tokens rst
           where rst.role_session_id = crs.id and rst.expires_at > now()
         )
  from public.crew_role_sessions crs
  where crs.restaurant_id = v_restaurant
    and (p_date is null or (crs.checked_in_at at time zone 'Asia/Jakarta')::date = p_date)
  order by crs.checked_in_at desc
  limit (case when p_date is null then 300 else 500 end);
end;
$$;
revoke all on function public.get_manager_crew_history(text, date) from public, anon, service_role;
grant execute on function public.get_manager_crew_history(text, date) to authenticated;

-- Terpenuhkan penuh oleh get_manager_crew_history.
drop function if exists public.get_manager_active_crew(text);
```

- [ ] **Step 4: Server fn + tipe**

Di `src/lib/manager-dashboard.server.ts` — hapus blok `managerActiveCrewInputSchema`,
`ActiveCrewRow`, `ManagerActiveCrewResult`, `getManagerActiveCrewCore`,
`getManagerActiveCrew`; ganti dengan:

```ts
export const managerCrewHistoryInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CrewHistoryRow = {
  role: string;
  displayName: string;
  checkedInAt: string;
  isActive: boolean;
};
export type ManagerCrewHistoryResult =
  | { ok: true; crew: CrewHistoryRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export async function getManagerCrewHistoryCore(
  data: { managerToken: string; date?: string },
  rpc: RpcCaller,
): Promise<ManagerCrewHistoryResult> {
  try {
    const { data: rows, error } = await rpc("get_manager_crew_history", {
      p_manager_token: data.managerToken,
      p_date: data.date ?? null,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    const crew = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        role: String(r.role),
        displayName: String(r.display_name),
        checkedInAt: String(r.checked_in_at),
        isActive: Boolean(r.is_active),
      };
    });
    return { ok: true, crew };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerCrewHistory = createServerFn({ method: "GET" })
  .validator(managerCrewHistoryInputSchema)
  .handler(async ({ data }): Promise<ManagerCrewHistoryResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerCrewHistoryCore(
      { managerToken: data.managerToken, date: data.date },
      async (fn, params) => client.rpc(fn, params),
    );
  });
```

Di `src/lib/manager-crew-groups.ts` — ganti import + tipe:

```ts
import type { CrewHistoryRow } from "./manager-dashboard.server";
```
```ts
export type CrewStationGroup = { label: string; members: CrewHistoryRow[] };

export function groupActiveCrewByStation(rows: readonly CrewHistoryRow[]): CrewStationGroup[] {
```

Di `tests/manager-crew-groups.test.ts` — ganti tipe + fixture:

```ts
import type { CrewHistoryRow } from "../src/lib/manager-dashboard.server";
```
```ts
    const rows: CrewHistoryRow[] = [
      { role: "clear_up", displayName: "Dadan", checkedInAt: "2026-09-04T10:00:00Z", isActive: false },
      { role: "kasir", displayName: "Rina", checkedInAt: "2026-09-04T09:00:00Z", isActive: true },
      { role: "kasir", displayName: "Sari", checkedInAt: "2026-09-04T09:30:00Z", isActive: true },
    ];
```

Di `src/routes/manager/index.tsx` (query swap dulu; switcher menyusul Task 3):

- Import: `getManagerActiveCrew` → `getManagerCrewHistory`; tambah
  `import { crewEmptyText, scopeQueryKey, scopeToParams, type CrewScope } from "@/lib/crew-history-scope";`
- State (dekat state lain): `const [crewScope, setCrewScope] = useState<CrewScope>({ kind: "today" });`
- Query `crew` diganti:

```tsx
  const crew = useQuery({
    queryKey: ["manager-crew-history", restaurantId, scopeQueryKey(crewScope)],
    queryFn: async () =>
      getManagerCrewHistory({
        data: {
          managerToken: identity!.managerToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
          ...scopeToParams(crewScope),
        },
      }),
    enabled: Boolean(identity) && menu === "crew",
  });
```

- Empty state mobile (blok "Tidak ada crew aktif.") diganti:

```tsx
                                 {crewEmptyText(crewScope)}
```

- [ ] **Step 5: Jalankan test + typecheck, pastikan hijau**

Run: `npx prettier --write src/lib/manager-dashboard.server.ts src/lib/manager-crew-groups.ts tests/manager-crew-groups.test.ts src/routes/manager/index.tsx tests/manager-crew-history.test.ts`
Run: `npx vitest run tests/manager-crew-history.test.ts tests/manager-crew-groups.test.ts tests/crew-history-scope.test.ts`
Expected: PASS semua.
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260906120000_manager_crew_history.sql src/lib/manager-dashboard.server.ts src/lib/manager-crew-groups.ts tests/manager-crew-groups.test.ts src/routes/manager/index.tsx tests/manager-crew-history.test.ts
git commit -m "feat(manager): RPC + server fn riwayat crew per tanggal WIB"
```

---

### Task 3: Switcher UI (kalender) + badge AKTIF

**Files:**
- Modify: `src/routes/manager/index.tsx`
- Modify: `tests/manager-crew-history.test.ts`

- [ ] **Step 1: Tambah test gagal (source assertion UI)**

Tambah `it` baru di `tests/manager-crew-history.test.ts` (dalam `describe` yang sama):

```ts
  it("menyediakan switcher scope dengan kalender di menu crew", () => {
    const page = read("../src/routes/manager/index.tsx");
    expect(page).toContain("Hari ini");
    expect(page).toContain("Semua");
    expect(page).toContain("Popover");
    expect(page).toContain("<Calendar");
    expect(page).toContain("formatScopeDate");
    expect(page).toContain("AKTIF");
  });
```

- [ ] **Step 2: Jalankan test, pastikan bagian baru gagal**

Run: `npx vitest run tests/manager-crew-history.test.ts`
Expected: FAIL pada `it` switcher.

- [ ] **Step 3: Implementasi switcher**

Di `src/routes/manager/index.tsx`:

1. Imports tambahan:

```tsx
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatScopeDate, wibDateKey } from "@/lib/crew-history-scope";
import { parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";
```

2. State dekat `crewScope`: `const [calOpen, setCalOpen] = useState(false);`
   + helper pill (level modul, dekat `MobileStat`):

```tsx
function crewScopePillClass(active: boolean) {
  return `inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-bold uppercase transition ${
    active
      ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300"
      : "border-ta-gray-200 bg-white text-ta-gray-500 hover:border-brand-300 hover:text-brand-500 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-400"
  }`;
}
```

3. Di dalam blok `menu === "crew"`, sebelum `{crew.isLoading && (...)}` sisipkan:

```tsx
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCrewScope({ kind: "today" })}
                className={crewScopePillClass(crewScope.kind === "today")}
              >
                Hari ini
              </button>
              <Popover open={calOpen} onOpenChange={setCalOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={crewScopePillClass(crewScope.kind === "date")}
                  >
                    <CalendarDays className="size-4" />
                    {crewScope.kind === "date" ? formatScopeDate(crewScope.date) : "Pilih Tanggal"}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={localeId}
                    selected={
                      crewScope.kind === "date"
                        ? parseISO(crewScope.date)
                        : crewScope.kind === "today"
                          ? parseISO(wibDateKey())
                          : undefined
                    }
                    defaultMonth={
                      crewScope.kind === "date" ? parseISO(crewScope.date) : undefined
                    }
                    onSelect={(d) => {
                      if (!d) return;
                      const key = wibDateKey(d);
                      setCalOpen(false);
                      setCrewScope(key === wibDateKey() ? { kind: "today" } : { kind: "date", date: key });
                    }}
                  />
                </PopoverContent>
              </Popover>
              <button
                type="button"
                onClick={() => setCrewScope({ kind: "all" })}
                className={crewScopePillClass(crewScope.kind === "all")}
              >
                Semua
              </button>
            </div>
```

4. Badge AKTIF + redup untuk crew non-aktif — path desktop (sel nama):

```tsx
                                    <td
                                      className={`border border-black/10 px-3 py-2 text-center font-bold uppercase ${
                                        m && !m.isActive
                                          ? "text-ta-gray-400 dark:text-ta-gray-500"
                                          : "text-ta-gray-800 dark:text-ta-gray-100"
                                      }`}
                                    >
                                      {m?.displayName ?? ""}
                                      {m?.isActive && (
                                        <span className="ml-1 inline-flex rounded-full bg-ta-success/15 px-1.5 py-0.5 align-middle text-[9px] font-black uppercase text-ta-success">
                                          AKTIF
                                        </span>
                                      )}
                                    </td>
```

Path mobile (sel nama) sama polanya:

```tsx
                                <td
                                  className={`border border-black/10 px-3 py-2 text-center font-bold uppercase ${
                                    m && !m.isActive
                                      ? "text-ta-gray-400 dark:text-ta-gray-500"
                                      : "text-ta-gray-800 dark:text-ta-gray-100"
                                  }`}
                                >
                                  {m.displayName}
                                  {m.isActive && (
                                    <span className="ml-1 inline-flex rounded-full bg-ta-success/15 px-1.5 py-0.5 align-middle text-[9px] font-black uppercase text-ta-success">
                                      AKTIF
                                    </span>
                                  )}
                                </td>
```

- [ ] **Step 4: Jalankan test, pastikan hijau**

Run: `npx prettier --write src/routes/manager/index.tsx tests/manager-crew-history.test.ts`
Run: `npx vitest run tests/manager-crew-history.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/index.tsx tests/manager-crew-history.test.ts
git commit -m "feat(manager): switcher tanggal kalender + badge AKTIF di kartu crew"
```

---

### Task 4: Gate penuh + migration produksi

- [ ] **Step 1: Gate penuh**

Run: `npm run verify`
Expected: exit 0 (semua test + typecheck + lint + build).

- [ ] **Step 2: Commit sisa (bila ada) lalu laporkan**

Pastikan `git status --short` bersih terhadap file fitur; laporkan SHA untuk persetujuan push.

- [ ] **Step 3: Apply migration ke Supabase produksi (setelah push disetujui)**

`apply_migration` name `manager_crew_history` dengan SQL dari Task 2 Step 3 ke proyek
`kjzxtmxdbcanvkgqqdow` — dijalankan sebelum/bersamaan dengan deploy Vercel agar RPC sudah
tersedia saat kode baru live.
