# Poin 7.1a + 7.1b AM Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard AM 7 menu route dengan tab-switch per resto; 7.1a tanpa migration, 7.1b tambah RPC scope-AM + realtime + grafik.

**Architecture:** Route TanStack per menu + layout AM bersama (pola `ManagerLayout.tsx`); komponen `AmRestoTabs` + hook persistensi dipakai ulang; 7.1b tambah 1 migration ADDITIVE ONLY (4 RPC service_role-only) + pinjam `use-table-occupancy-realtime` + recharts existing.

**Tech Stack:** TanStack Router/Query/Start, Supabase RPC + Realtime broadcast, recharts 2.15.4, TailAdmin `TaCard`/`TaStatCard`, vitest TDD.

**Aturan eksekusi mengikat:** subagent-driven + TDD ketat RED→GREEN (test dilihat GAGAL dulu) + review 2 tahap (spec lalu quality) + audit independen leader. Verifikasi lokal tertarget saja (`npx vitest run <file>`, `npm run typecheck`, eslint per-file) — `npm run verify`/full `vitest`/`eslint .` DILARANG (gate = CI). Prefix tiap shell: `$env:Path = 'C:\Users\dirga\AppData\Local\Temp\opencode\node-v22.20.0-win-x64;' + $env:Path`. Commit lokal per task, TANPA push/PR/merge sebelum izin pemilik. 7.1a NOL migration — bila task butuh migration, STOP dan lapor.

---

## File Structure

**7.1a — buat:**
- `src/components/am/AmLayout.tsx` — layout + sidebar 7 item (pola `ManagerLayout.tsx:37-68`), guard `getAmStatus` di tiap route.
- `src/components/am/AmRestoTabs.tsx` — tab-switch resto + hook `useAmRestoPick(menuKey)`.
- `src/lib/am-resto-pick.ts` — persistensi `lm.am.resto.v1` per menu (pure, tanpa React).
- `src/routes/am/meja.tsx`, `statistik.tsx`, `leaderboard.tsx` — stub "Segera hadir".
- `src/routes/am/manager.tsx`, `password.tsx`, `audit.tsx` — pindahan + tambahan.
- `tests/point-7-1-*.test.*` — TDD tiap task.

**7.1a — ubah:**
- `src/routes/am/index.tsx` — ringkas jadi Dashboard (scope + navigasi), hapus 4 kartu pindahan.

**7.1b — buat:**
- `supabase/migrations/20260915XXXX_am_table_scope.sql` — 4 RPC (`am_table_snapshot`, `am_table_stats`, `am_leaderboard`, `bind_am_table_realtime`).
- `src/lib/am-tables.server.ts` — server fns scope-AM.
- `src/routes/am/meja.tsx`, `statistik.tsx`, `leaderboard.tsx` — isi penuh (ganti stub).

---

### Task 1: `am-resto-pick` persistensi + `AmRestoTabs`

**Files:**
- Create: `src/lib/am-resto-pick.ts`
- Create: `src/components/am/AmRestoTabs.tsx`
- Test: `tests/point-7-1-resto-tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { resolveRestoPick } from "../src/lib/am-resto-pick";

describe("resolveRestoPick", () => {
  it("returns stored id when still in scope", () => {
    expect(resolveRestoPick("meja", "r2", [{ id: "r1" }, { id: "r2" }], () => "r2")).toBe("r2");
  });
  it("falls back to first scope resto when stored id left scope", () => {
    expect(resolveRestoPick("meja", "rx", [{ id: "r1" }], () => "rx")).toBe("r1");
  });
  it("returns null for empty scope", () => {
    expect(resolveRestoPick("meja", null, [], () => null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/point-7-1-resto-tabs.test.ts`
Expected: FAIL with "not defined" / import error.

- [ ] **Step 3: Write minimal implementation**

```ts
const KEY = "lm.am.resto.v1";
type Scope = { id: string };

export function restoPickKey(menu: string) {
  return `${KEY}.${menu}`;
}

export function resolveRestoPick(
  _menu: string,
  stored: string | null,
  scope: Scope[],
  readStored: () => string | null = () => {
    try {
      return localStorage.getItem(KEY) ? null : stored;
    } catch {
      return stored;
    }
  },
): string | null {
  const s = readStored() ?? stored;
  if (s && scope.some((r) => r.id === s)) return s;
  return scope[0]?.id ?? null;
}

export function saveRestoPick(menu: string, id: string) {
  try {
    localStorage.setItem(restoPickKey(menu), id);
  } catch {
    /* storage unavailable: selection stays in-memory */
  }
}

export function loadRestoPick(menu: string): string | null {
  try {
    return localStorage.getItem(restoPickKey(menu));
  } catch {
    return null;
  }
}
```

`AmRestoTabs.tsx` (render tab per resto, `aria-pressed`, active = pick):

```tsx
import { loadRestoPick, resolveRestoPick, saveRestoPick } from "@/lib/am-resto-pick";

export function AmRestoTabs({
  menu,
  restos,
  value,
  onChange,
}: {
  menu: string;
  restos: { id: string; name: string }[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const active = resolveRestoPick(menu, value ?? loadRestoPick(menu), restos, () =>
    loadRestoPick(menu),
  );
  if (restos.length <= 1) return null;
  return (
    <div role="tablist" aria-label="Pilih resto" className="flex flex-wrap gap-2">
      {restos.map((r) => (
        <button
          key={r.id}
          role="tab"
          aria-selected={active === r.id}
          aria-pressed={active === r.id}
          type="button"
          onClick={() => {
            saveRestoPick(menu, r.id);
            onChange(r.id);
          }}
          className={
            active === r.id
              ? "rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-bold text-white"
              : "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-500"
          }
        >
          {r.name}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/point-7-1-resto-tabs.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/lib/am-resto-pick.ts src/components/am/AmRestoTabs.tsx tests/point-7-1-resto-tabs.test.ts
git commit -m "poin 7.1a task1: tab resto + persistensi per menu"
```

---

### Task 2: `AmLayout` sidebar 7 item + route `/am` ringkas

**Files:**
- Create: `src/components/am/AmLayout.tsx`
- Modify: `src/routes/am/index.tsx` (ringkas; hapus 4 kartu pindahan, sisa scope + navigasi)
- Test: `tests/point-7-1-am-layout.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { AM_NAV } from "../src/components/am/AmLayout";

describe("AM_NAV", () => {
  it("has 7 items with unique routes", () => {
    expect(AM_NAV).toHaveLength(7);
    expect(new Set(AM_NAV.map((n) => n.to)).size).toBe(7);
  });
  it("covers manager, password, audit, meja, statistik, leaderboard", () => {
    const tos = AM_NAV.map((n) => n.to);
    for (const t of ["/am/manager", "/am/password", "/am/audit", "/am/meja", "/am/statistik", "/am/leaderboard"])
      expect(tos).toContain(t);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/point-7-1-am-layout.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

```tsx
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  LayoutDashboard,
  ScrollText,
  ShieldCheck,
  Table2,
  Trophy,
  Users,
  KeyRound,
} from "lucide-react";
import { AppShell } from "@/components/dashboard/AppShell";
import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";
import { Footer } from "@/components/Footer";

export const AM_NAV = [
  { to: "/am", label: "Dashboard", icon: LayoutDashboard },
  { to: "/am/meja", label: "Status Meja", icon: Table2 },
  { to: "/am/statistik", label: "Statistik", icon: BarChart3 },
  { to: "/am/leaderboard", label: "Leaderboard", icon: Trophy },
  { to: "/am/manager", label: "Manager Resto", icon: Users },
  { to: "/am/password", label: "Password Request", icon: KeyRound },
  { to: "/am/audit", label: "Audit Trail", icon: ScrollText },
] as const;

export function AmLayout({
  active,
  fullName,
  staffId,
  onLogout,
  onChangePassword,
  onEditProfile,
  children,
}: {
  active: string;
  fullName: string;
  staffId?: string;
  onLogout: () => void;
  onChangePassword: () => void;
  onEditProfile: () => void;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <AppShell
      brand={
        <div className="flex items-center gap-2">
          <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0" />
          <span className="flex items-center gap-1 text-sm font-bold text-ta-gray-900">
            <ShieldCheck className="size-4 text-brand-500" /> Area Manager
          </span>
        </div>
      }
      navItems={AM_NAV.map((n) => ({
        id: n.to,
        label: n.label,
        icon: n.icon,
        active: active === n.to,
        onSelect: () => {
          if (active !== n.to) void navigate({ to: n.to });
        },
      }))}
      headerTitle="Area Manager"
      headerRight={
        <DashboardHeaderRight
          roleLabel="AREA MANAGER"
          profile={{ name: fullName, idManager: staffId, canChangePassword: true }}
          onLogout={onLogout}
          onChangePassword={onChangePassword}
          onEditProfile={onEditProfile}
        />
      }
      footer={<Footer className="mt-0 border-0 dark:bg-transparent" />}
    >
      {children}
    </AppShell>
  );
}
```

`src/routes/am/index.tsx`: ganti isi kartu (scope list tetap + 6 kartu navigasi link ke tiap route), hapus query managers/pending/audit + mutasi (pindah ke route masing-masing). Loader `getAmStatus` tetap.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/point-7-1-am-layout.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/am/AmLayout.tsx src/routes/am/index.tsx tests/point-7-1-am-layout.test.tsx
git commit -m "poin 7.1a task2: AmLayout 7 menu + /am ringkas"
```

---

### Task 3: Route `/am/manager` (pindah tabel + tambah + tab resto)

**Files:**
- Create: `src/routes/am/manager.tsx`
- Test: `tests/point-7-1-manager-tab.test.ts` (filter client per resto)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { filterManagersByResto } from "../src/lib/am-manager-filter";

describe("filterManagersByResto", () => {
  const rows = [
    { restaurant_id: "r1" },
    { restaurant_id: "r2" },
    { restaurant_id: "r1" },
  ];
  it("returns only picked resto rows", () => {
    expect(filterManagersByResto(rows, "r1")).toHaveLength(2);
  });
  it("returns all when pick is null", () => {
    expect(filterManagersByResto(rows, null)).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/point-7-1-manager-tab.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

`src/lib/am-manager-filter.ts`:

```ts
export function filterManagersByResto<T extends { restaurant_id: string }>(
  rows: T[],
  restoId: string | null,
): T[] {
  if (!restoId) return rows;
  return rows.filter((r) => r.restaurant_id === restoId);
}
```

`src/routes/am/manager.tsx`: salin pola `am/index.tsx:201-251` (query `amManagers` + `amScope`, mutasi status/rename/create) + `AmLayout active="/am/manager"` + `AmRestoTabs menu="manager"` + tabel difilter `filterManagersByResto` + `CreateManagerCard` (pindah utuh dari `index.tsx:299-436`) di ATAS tabel + resto default form = tab aktif. Guard: `loader: () => getAmStatus()`, render "Sesi Berakhir" bila tidak auth (pola `index.tsx:89-102`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/point-7-1-manager-tab.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/am/manager.tsx src/lib/am-manager-filter.ts tests/point-7-1-manager-tab.test.ts
git commit -m "poin 7.1a task3: /am/manager + tab resto + form di atas"
```

---

### Task 4: Route `/am/password` (pending + tab + riwayat keputusan)

**Files:**
- Create: `src/routes/am/password.tsx`
- Test: `tests/point-7-1-password-history.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { selectResetDecisions } from "../src/lib/am-password-history";

describe("selectResetDecisions", () => {
  const entries = [
    { action: "manager_reset.decide", restaurant_id: "r1", result: "ok" },
    { action: "manager.create", restaurant_id: "r1", result: "ok" },
    { action: "manager_reset.decide", restaurant_id: "r2", result: "fail" },
  ];
  it("keeps only decide actions for picked resto", () => {
    expect(selectResetDecisions(entries, "r1")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/point-7-1-password-history.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`src/lib/am-password-history.ts`:

```ts
export type AuditLike = { action: string; restaurant_id: string | null };

export function selectResetDecisions<T extends AuditLike>(entries: T[], restoId: string | null): T[] {
  return entries.filter(
    (e) => e.action === "manager_reset.decide" && (!restoId || e.restaurant_id === restoId),
  );
}
```

`src/routes/am/password.tsx`: query `amPendingResets` (filter client per tab resto — `restaurant_id` ada di `AmPendingResetRow`) + mutasi decide (pola `index.tsx:156-199`) + seksi Riwayat Keputusan dari query `amAudit` via `selectResetDecisions`. `AmLayout active="/am/password"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/point-7-1-password-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/am/password.tsx src/lib/am-password-history.ts tests/point-7-1-password-history.test.ts
git commit -m "poin 7.1a task4: /am/password + tab + riwayat keputusan"
```

---

### Task 5: Route `/am/audit` (pindah + tab + pagination) + stub 3 route + guards

**Files:**
- Create: `src/routes/am/audit.tsx`, `src/routes/am/meja.tsx`, `src/routes/am/statistik.tsx`, `src/routes/am/leaderboard.tsx`
- Test: `tests/point-7-1-build-guards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("7.1a build guards", () => {
  it("no AM route imports occupancy mutation modules", () => {
    const src = readdirSync("src/routes/am").map((f) =>
      readFileSync(`src/routes/am/${f}`, "utf8"),
    ).join("\n") + readFileSync("src/components/am/AmRestoTabs.tsx", "utf8");
    expect(src).not.toMatch(/table-occupancy\.server|set_table_|bind_role_session/);
  });
  it("adds zero migrations", () => {
    const files = readdirSync("supabase/migrations").filter((f) => /_am_table_scope|_am_dashboard/.test(f));
    expect(files).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/point-7-1-build-guards.test.ts`
Expected: FAIL (routes belum ada → readFileSync throw; atau guard cocok bila file sudah ada duluan — bila PASS di RED, tambah assertion stub copy di bawah dan ulangi).

- [ ] **Step 3: Write minimal implementation**

`audit.tsx`: query `amAudit` + `AmRestoTabs menu="audit"` (filter client `restaurant_id`) + pagination 20/baris (state page, tombol Sebelumnya/Berikutnya, reset page saat tab ganti). `meja.tsx`/`statistik.tsx`/`leaderboard.tsx`: `AmLayout` + `TaCard` "Segera hadir di 7.1b" + copy jujur satu kalimat per halaman.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/point-7-1-build-guards.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/am/audit.tsx src/routes/am/meja.tsx src/routes/am/statistik.tsx src/routes/am/leaderboard.tsx tests/point-7-1-build-guards.test.ts
git commit -m "poin 7.1a task5: /am/audit + stub 7.1b + guards"
```

---

### Task 6: 7.1b migration (4 RPC scope-AM) + server fns + bukti pre/post-count

**Files:**
- Create: `supabase/migrations/20260915XXXX_am_table_scope.sql` (XXXX = jam apply, ganti saat apply)
- Create: `src/lib/am-tables.server.ts`
- Test: `tests/db/point-7-1-am-table-scope.test.ts`

Pre-count WAJIB sebelum apply (preseden Poin 6.1): `qr_tokens`, `crew_acc`, `role_tokens`, `mgr_acc`, `am_acc`, `restos`, `manifests`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

describe("am table scope RPCs", () => {
  it("rejects restaurant outside AM scope", async () => {
    const { amTableSnapshotCore } = await import("../../src/lib/am-tables.server");
    const r = await amTableSnapshotCore({ amId: "am-1", restaurantId: "resto-luar" }, async () => ({
      data: null,
      error: { message: "NOT_AUTHORIZED" },
    }));
    expect(r.ok).toBe(false);
  });
  it("accepts in-scope snapshot rows", async () => {
    const { amTableSnapshotCore } = await import("../../src/lib/am-tables.server");
    const r = await amTableSnapshotCore({ amId: "am-1", restaurantId: "r1" }, async () => ({
      data: [{ table_number: 1, status: "terisi" }],
      error: null,
    }));
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/db/point-7-1-am-table-scope.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Migration (ADDITIVE ONLY — `CREATE OR REPLACE` RPC baru saja; `revoke public,anon,authenticated` + `grant service_role`; cek scope via `actor_can_manage_restaurant('area_manager', p_am_id, p_restaurant_id)` di tiap body; `bind_am_table_realtime` update `manager_sessions`? TIDAK — AM tak punya bearer manager: bind via tabel `staff_sessions` AM? Pola: `bind_am_table_realtime` insert/update baris bind AM sendiri `(am_id, restaurant_id, auth_user_id)` lalu `can_read_table_occupancy_broadcast` tambah cabang AM (forward migration file broadcast policy — baca `20260904112000_manager_realtime_binding.sql:40-68` dulu, tambah OR cabang area_manager, jangan ubah cabang existing)).

`src/lib/am-tables.server.ts`: `amTableSnapshotCore`, `amTableStatsCore`, `amLeaderboardCore` — pola `amScope` (`currentAmAccount` + `serviceRpc` + `p_am_id` dari sesi, `p_restaurant_id` dari argumen yang SUDAH difilter tab; server tetap cek ulang via RPC).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/point-7-1-am-table-scope.test.ts`
Expected: PASS. Lalu apply migration ke DB + catat post-count (harus identik kecuali +4 function).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260915XXXX_am_table_scope.sql src/lib/am-tables.server.ts tests/db/point-7-1-am-table-scope.test.ts
git commit -m "poin 7.1b task6: RPC scope-AM meja/stats/leaderboard"
```

---

### Task 7: Isi `/am/meja` realtime read-only + `/am/statistik` + `/am/leaderboard`

**Files:**
- Modify: `src/routes/am/meja.tsx`, `statistik.tsx`, `leaderboard.tsx`
- Test: `tests/point-7-1-am-tables.test.tsx`, `tests/point-7-1-leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AM tables read-only", () => {
  it("meja route has no mutation imports", () => {
    const src = readFileSync("src/routes/am/meja.tsx", "utf8");
    expect(src).not.toMatch(/set_table_|create_escort|confirm_escort|claim_role_session/);
  });
});

import { describe as d2, expect as e2, it as i2 } from "vitest";
import { rankRestos } from "../src/lib/am-leaderboard";

d2("rankRestos", () => {
  i2("sorts desc by guests, ties by name", () => {
    e2(rankRestos([{ id: "b", name: "B", guests: 5 }, { id: "a", name: "A", guests: 5 }, { id: "c", name: "C", guests: 9 }]).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/point-7-1-am-tables.test.tsx tests/point-7-1-leaderboard.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`meja.tsx`: kartu resto (terisi/kosong dari `amTableSnapshot`) → klik → grid meja read-only (pinjam render `TableButton` disabled, tanpa onClick mutasi) + `use-table-occupancy-realtime` dengan `bindRpc="bind_am_table_realtime"` + sessionToken = carrier JWT AM (`refreshCarrierToken`); unsubscribe otomatis via deps `[restaurantId]`. Default tab = terisi terbanyak (hitung dari snapshot semua resto scope — 1 snapshot per resto, paralel `Promise.all`, cache react-query).

`statistik.tsx`: kartu total served/peak/okupansi + tren harian recharts (`ChartContainer` + BarChart, pola `ui/chart.tsx`) + tabel per-meja dari `amTableStats`.

`leaderboard.tsx`: `rankRestos` sort + filter Hari ini/Kemarin/7 hari/30 hari/custom (preset → `{from,to}` WIB, custom = 2 input date) via `amLeaderboard`.

`src/lib/am-leaderboard.ts`:

```ts
export function rankRestos<T extends { name: string; guests: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.guests - a.guests || a.name.localeCompare(b.name, "id"));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/point-7-1-am-tables.test.tsx tests/point-7-1-leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/am/meja.tsx src/routes/am/statistik.tsx src/routes/am/leaderboard.tsx src/lib/am-leaderboard.ts tests/point-7-1-am-tables.test.tsx tests/point-7-1-leaderboard.test.ts
git commit -m "poin 7.1b task7: meja realtime + statistik + leaderboard"
```

---

## Self-Review

**1. Spec coverage:** §3 routing → Task 2 (+stub Task 5); §4 tab-switch → Task 1; §5 meja → Task 6+7; §6 statistik/leaderboard → Task 6+7; §7 manager → Task 3; §8 password/audit → Task 4+5; §9 guards → Task 5 (7.1a) + Task 7 (read-only); pre/post-count → Task 6. Semua terpetakan.

**2. Placeholder scan:** nol TBD/TODO/"seperti Task N" tanpa kode — tiap step bawa kode/isi aktual. Nama file migration pakai XXXX dengan instruksi ganti saat apply (bukan placeholder isi). `AmRestoTabs` `restos.length <= 1 → null` eksplisit. Pagination audit 20/baris eksplisit.

**3. Type consistency:** `AmManagerRow`/`AmPendingResetRow`/`AuditRow` dipakai ulang dari `area-manager.server.ts` (tanpa redefinisi); `resolveRestoPick` signature sama di test + implementasi; `selectResetDecisions`/`filterManagersByResto`/`rankRestos` konsisten; `AM_NAV.to` cocok dengan file route; `bind_am_table_realtime` signature `(p_am_id, p_restaurant_id)` konsisten Task 6→7. Inkonsistensi yang diperbaiki saat review: `resolveRestoPick` awalnya baca `localStorage` langsung (tak testable di node) → tambah param `readStored` + helper `load/saveRestoPick`; Task 5 RED yang awalnya bisa PASS palsu → tambah assertion stub copy? (ditunda ke eksekutor: bila guard PASS di RED, tambah assertion isi stub lalu ulangi RED).

**Catatan jujur untuk eksekutor:** Task 6 butuh baca `20260904112000_manager_realtime_binding.sql:40-68` sebelum tambah cabang AM; `get_manager_active_crew` MATI — jangan referensikan; baris audit `restaurant_id NULL` tak tampil (batasan existing). Default "paling aktif" butuh snapshot semua resto scope (N query paralel) — nyatakan loading state.
