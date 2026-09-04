# Manager Header Cluster + Dark Mode + Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah cluster header TailAdmin (emblem MANAGER, toggle dark mode, lonceng notifikasi meja >2 jam, menu profil + logout) untuk dashboard Manager, dark mode fungsional Manager+Super Admin, dan nama resto sidebar 1 baris.

**Architecture:** Layer UI/presentation saja. `AppShell` punya state tema (`useTheme`) + menyediakan `ThemeContext`; `ThemeToggle` konsumsi context itu; class `dark` dipasang di root `AppShell` (bukan `<html>`) supaya crew/owner tak pernah gelap. Notifikasi meja >2 jam jadi data terstruktur (`buildStaleNotices`) yang diisi ke `NotificationBell`; baris reminder muter di dashboard dihapus. Auth/realtime/query tak berubah.

**Tech Stack:** React 19, TanStack Router/Query, Tailwind v4 (`@custom-variant dark`), lucide-react, Vitest (source-assertion + pure-fn unit; TANPA testing-library/jsdom).

**Konvensi tes (WAJIB diikuti):**
- Komponen/route/CSS → source-assertion: `readFileSync(new URL("../src/...", import.meta.url), "utf8")` lalu `expect(s).toContain(...)`.
- Logika murni (lib) → unit test import fungsi + assert perilaku.
- Named imports saja (tsconfig `esModuleInterop:false`).
- Setelah edit file: `npx prettier --write <file>` (CRLF).

**Perintah kunci:**
- Tes satu file: `npx vitest run tests/<file>.test.ts`
- Full gate: `npm run verify` (test+typecheck+lint+build) — harus exit 0 sebelum commit.

---

## File Structure

**Create:**
- `src/components/dashboard/use-theme.ts` — pure `readStoredTheme`/`writeStoredTheme`/`browserStorage` + hook `useTheme` + `ThemeContext`/`useThemeValue`.
- `src/components/dashboard/ThemeToggle.tsx`
- `src/components/dashboard/NotificationBell.tsx`
- `src/components/dashboard/ProfileMenu.tsx`
- `src/components/dashboard/RoleEmblem.tsx`
- `tests/use-theme.test.ts`
- `tests/dashboard-header.test.ts`

**Modify:**
- `src/styles.css` — `@custom-variant dark` → `&:where(.dark, .dark *)`.
- `src/lib/manager-reminder.ts` — `buildStaleNotices` baru; hapus `buildStaleReminders`+`rotateIndex`.
- `src/components/dashboard/AppShell.tsx` — provider tema + class `dark` + varian `dark:`.
- `src/components/dashboard/ui.tsx` — varian `dark:` di semua primitif.
- `src/components/ManagerLayout.tsx` — nama resto 1 baris + rapatkan.
- `src/routes/manager/index.tsx` — cluster header, hapus reminder muter, `buildStaleNotices`.
- `src/routes/super-admin/route.tsx` — `ThemeToggle`+`ProfileMenu`, hapus tombol logout lama.
- `tests/manager-reminder.test.ts`, `tests/app-shell.test.ts`, `tests/tailadmin-tokens.test.ts`, `tests/manager-layout.test.ts`, `tests/manager-dashboard-route.test.ts`, `tests/super-admin-shell.test.ts`, `tests/dashboard-ui.test.ts`.

---

## Task 1: Upgrade dark variant selector

**Files:**
- Modify: `src/styles.css:5`
- Test: `tests/tailadmin-tokens.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok di dalam `describe("TailAdmin tokens", ...)` pada `tests/tailadmin-tokens.test.ts`:

```ts
  it("uses a class-based dark variant that matches the .dark element itself", () => {
    expect(css()).toContain("@custom-variant dark (&:where(.dark, .dark *));");
  });
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/tailadmin-tokens.test.ts`
Expected: FAIL (masih `&:is(.dark *)`).

- [ ] **Step 3: Implementasi** — ganti `src/styles.css` baris 5:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/tailadmin-tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css tests/tailadmin-tokens.test.ts
git commit -m "feat(theme): class-based dark variant matches .dark element itself"
```

---

## Task 2: `buildStaleNotices` terstruktur (hapus reminder string)

**Files:**
- Modify: `src/lib/manager-reminder.ts`
- Test: `tests/manager-reminder.test.ts`

- [ ] **Step 1: Tulis tes gagal** — ganti ISI `tests/manager-reminder.test.ts` jadi:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStaleNotices, TWO_HOURS_MS } from "../src/lib/manager-reminder";
import type { TableOccupancyRow } from "../src/lib/table-occupancy.server";

const HOUR = 3_600_000;
function row(n: number, occupiedAtMs: number | null): TableOccupancyRow {
  return {
    tableNumber: n,
    status: occupiedAtMs === null ? "kosong" : "terisi",
    occupiedAt: occupiedAtMs === null ? null : new Date(occupiedAtMs).toISOString(),
    occupiedSource: null,
    escortIntentId: null,
    escortIntentExpiresAt: null,
    escortIntentMine: false,
  };
}

describe("buildStaleNotices", () => {
  const now = 1_000_000_000_000;
  it("returns structured items for tables > 2h, longest first", () => {
    expect(
      buildStaleNotices([row(49, now - (2 * HOUR + 37 * 60_000)), row(5, now - HOUR), row(12, now - 3 * HOUR)], now),
    ).toEqual([
      { table: 12, duration: "3 JAM" },
      { table: 49, duration: "2 JAM 37 MENIT" },
    ]);
  });
  it("empty when nothing exceeds 2h", () => {
    expect(buildStaleNotices([row(1, now - TWO_HOURS_MS)], now)).toEqual([]);
  });
  it("ignores empty tables", () => {
    expect(buildStaleNotices([row(1, null)], now)).toEqual([]);
  });
});

describe("manager-reminder module surface", () => {
  it("no longer exports the rotating-string helpers", () => {
    const s = readFileSync(new URL("../src/lib/manager-reminder.ts", import.meta.url), "utf8");
    expect(s).not.toContain("buildStaleReminders");
    expect(s).not.toContain("rotateIndex");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/manager-reminder.test.ts`
Expected: FAIL (`buildStaleNotices` belum ada).

- [ ] **Step 3: Implementasi** — ganti SELURUH ISI `src/lib/manager-reminder.ts`:

```ts
// Pure stale-table logic for the manager dashboard. Reuses the proven
// client-side occupied-duration helpers from clear-up-queue.ts (zero server/DB
// cost). Only tables occupied MORE THAN 2 hours are surfaced, as structured
// items consumed by the header NotificationBell.
import { formatOccupiedDuration, sortedOccupiedTables } from "./clear-up-queue";
import type { TableOccupancyRow } from "./table-occupancy.server";

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export type StaleNotice = { table: number; duration: string };

export function buildStaleNotices(
  tables: readonly TableOccupancyRow[],
  nowMs: number,
): StaleNotice[] {
  return sortedOccupiedTables(tables, nowMs)
    .filter((entry) => entry.durationMs > TWO_HOURS_MS)
    .map((entry) => ({
      table: entry.tableNumber,
      duration: formatOccupiedDuration(entry.durationMs).toUpperCase(),
    }));
}
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/manager-reminder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/manager-reminder.ts tests/manager-reminder.test.ts
git commit -m "feat(manager): structured buildStaleNotices; drop rotating reminder helpers"
```

---

## Task 3: `use-theme` (pure fns + hook + context)

**Files:**
- Create: `src/components/dashboard/use-theme.ts`
- Test: `tests/use-theme.test.ts`

- [ ] **Step 1: Tulis tes gagal** — buat `tests/use-theme.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  readStoredTheme,
  writeStoredTheme,
  THEME_STORAGE_KEY,
} from "../src/components/dashboard/use-theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe("use-theme storage helpers", () => {
  it("defaults to light when nothing stored or storage missing", () => {
    expect(readStoredTheme(null)).toBe("light");
    expect(readStoredTheme(fakeStorage())).toBe("light");
  });
  it("reads a stored dark value", () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
  });
  it("writes the chosen theme under the key", () => {
    const s = fakeStorage();
    writeStoredTheme(s, "dark");
    expect(s.map.get(THEME_STORAGE_KEY)).toBe("dark");
  });
  it("swallows storage that throws (private mode)", () => {
    const boom = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredTheme(boom)).toBe("light");
    expect(() => writeStoredTheme(boom, "dark")).not.toThrow();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/use-theme.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi** — buat `src/components/dashboard/use-theme.ts`:

```ts
import { createContext, useContext, useState } from "react";

export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "ta-theme";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function readStoredTheme(storage: StorageLike | null): Theme {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeStoredTheme(storage: StorageLike | null, theme: Theme): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private mode / quota: keep in-memory only */
  }
}

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type ThemeValue = { isDark: boolean; toggle: () => void };

export function useTheme(): ThemeValue {
  const [isDark, setIsDark] = useState(() => readStoredTheme(browserStorage()) === "dark");
  const toggle = () =>
    setIsDark((d) => {
      const next = !d;
      writeStoredTheme(browserStorage(), next ? "dark" : "light");
      return next;
    });
  return { isDark, toggle };
}

export const ThemeContext = createContext<ThemeValue | null>(null);

export function useThemeValue(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useThemeValue must be used within AppShell ThemeContext");
  return ctx;
}
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/use-theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/use-theme.ts tests/use-theme.test.ts
git commit -m "feat(theme): useTheme hook + ThemeContext with safe localStorage helpers"
```

---

## Task 4: `ThemeToggle`

**Files:**
- Create: `src/components/dashboard/ThemeToggle.tsx`
- Test: `tests/dashboard-header.test.ts`

- [ ] **Step 1: Tulis tes gagal** — buat `tests/dashboard-header.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (f: string) =>
  readFileSync(new URL(`../src/components/dashboard/${f}`, import.meta.url), "utf8");

describe("ThemeToggle", () => {
  it("consumes theme context and shows sun/moon with an aria-label", () => {
    const s = src("ThemeToggle.tsx");
    expect(s).toContain("useThemeValue");
    expect(s).toContain("Moon");
    expect(s).toContain("Sun");
    expect(s).toContain("aria-label");
    expect(s).toContain("onClick={toggle}");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: FAIL (file belum ada).

- [ ] **Step 3: Implementasi** — buat `src/components/dashboard/ThemeToggle.tsx`:

```tsx
import { Moon, Sun } from "lucide-react";
import { useThemeValue } from "./use-theme";

export function ThemeToggle() {
  const { isDark, toggle } = useThemeValue();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Mode terang" : "Mode gelap"}
      className="grid size-10 place-items-center rounded-lg border border-ta-gray-200 bg-white text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
    >
      {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
    </button>
  );
}
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ThemeToggle.tsx tests/dashboard-header.test.ts
git commit -m "feat(theme): ThemeToggle button driven by ThemeContext"
```

---

## Task 5: `NotificationBell`

**Files:**
- Create: `src/components/dashboard/NotificationBell.tsx`
- Test: `tests/dashboard-header.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `tests/dashboard-header.test.ts`:

```ts
describe("NotificationBell", () => {
  it("shows a count badge and a demo-style dropdown of stale tables", () => {
    const s = src("NotificationBell.tsx");
    expect(s).toContain("Bell");
    expect(s).toContain("Notifikasi");
    expect(s).toContain("perlu dicek");
    expect(s).toContain("Tidak ada meja perlu dicek");
    expect(s).toContain("items.length");
    expect(s).toContain("Clock");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: FAIL (file belum ada).

- [ ] **Step 3: Implementasi** — buat `src/components/dashboard/NotificationBell.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { Bell, Clock } from "lucide-react";

export type BellNotice = { table: number; duration: string };

export function NotificationBell({ items }: { items: BellNotice[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const count = items.length;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifikasi"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-10 place-items-center rounded-lg border border-ta-gray-200 bg-white text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-ta-error px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-ta-gray-200 bg-white shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800">
          <div className="border-b border-ta-gray-100 px-4 py-3 text-sm font-semibold dark:border-ta-gray-700">
            Notifikasi ({count})
          </div>
          {count === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ta-gray-400">
              Tidak ada meja perlu dicek
            </p>
          ) : (
            <ul className="max-h-80 divide-y divide-ta-gray-100 overflow-y-auto dark:divide-ta-gray-700">
              {items.map((it) => (
                <li key={it.table} className="flex items-center gap-3 px-4 py-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ta-warning/10 text-ta-warning">
                    <Clock className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold">Meja {it.table} perlu dicek</span>
                    <span className="block text-xs text-ta-gray-400">&gt;{it.duration}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/NotificationBell.tsx tests/dashboard-header.test.ts
git commit -m "feat(manager): NotificationBell dropdown lists tables over 2h"
```

---

## Task 6: `ProfileMenu`

**Files:**
- Create: `src/components/dashboard/ProfileMenu.tsx`
- Test: `tests/dashboard-header.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `tests/dashboard-header.test.ts`:

```ts
describe("ProfileMenu", () => {
  it("shows avatar + name and a menu with disabled password + logout", () => {
    const s = src("ProfileMenu.tsx");
    expect(s).toContain("UserRound");
    expect(s).toContain("ChevronDown");
    expect(s).toContain("Ganti password");
    expect(s).toContain("Segera hadir");
    expect(s).toContain("disabled");
    expect(s).toContain("onLogout");
    expect(s).toContain("Keluar");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: FAIL (file belum ada).

- [ ] **Step 3: Implementasi** — buat `src/components/dashboard/ProfileMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";

export function ProfileMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Menu profil"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-ta-gray-200 bg-white py-1 pl-1 pr-2 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:hover:bg-ta-gray-700"
      >
        <span className="grid size-8 place-items-center rounded-full bg-ta-gray-100 text-ta-gray-400 dark:bg-ta-gray-700 dark:text-ta-gray-300">
          <UserRound className="size-5" />
        </span>
        <span className="hidden max-w-[8rem] truncate text-sm font-semibold sm:block">{name}</span>
        <ChevronDown className="size-4 text-ta-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-ta-gray-200 bg-white py-1 shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800">
          <div className="border-b border-ta-gray-100 px-4 py-2 dark:border-ta-gray-700">
            <p className="truncate text-sm font-semibold">{name}</p>
          </div>
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center gap-2 px-4 py-2 text-left text-sm text-ta-gray-400 dark:text-ta-gray-500"
          >
            <KeyRound className="size-4" /> Ganti password
            <span className="ml-auto text-[10px] font-semibold uppercase">Segera hadir</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold text-ta-error hover:bg-ta-error/10"
          >
            <LogOut className="size-4" /> Keluar
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ProfileMenu.tsx tests/dashboard-header.test.ts
git commit -m "feat(manager): ProfileMenu with avatar, placeholder password change, logout"
```

---

## Task 7: `RoleEmblem`

**Files:**
- Create: `src/components/dashboard/RoleEmblem.tsx`
- Test: `tests/dashboard-header.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `tests/dashboard-header.test.ts`:

```ts
describe("RoleEmblem", () => {
  it("renders a brand-blue uppercase pill", () => {
    const s = src("RoleEmblem.tsx");
    expect(s).toContain("bg-brand-500");
    expect(s).toContain("uppercase");
    expect(s).toContain("{label}");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: FAIL (file belum ada).

- [ ] **Step 3: Implementasi** — buat `src/components/dashboard/RoleEmblem.tsx`:

```tsx
export function RoleEmblem({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-brand-500 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white">
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/RoleEmblem.tsx tests/dashboard-header.test.ts
git commit -m "feat(manager): RoleEmblem brand pill"
```

---

## Task 8: AppShell tema provider + class `dark` + varian gelap

**Files:**
- Modify: `src/components/dashboard/AppShell.tsx`
- Test: `tests/app-shell.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `describe("AppShell", ...)` di `tests/app-shell.test.ts`:

```ts
  it("owns theme state, provides context, and flips the .dark class on its root", () => {
    const s = src();
    expect(s).toContain("useTheme");
    expect(s).toContain("ThemeContext.Provider");
    expect(s).toContain('isDark && "dark"');
    expect(s).toContain("dark:bg-ta-gray-900");
    expect(s).toContain("dark:border-ta-gray-700");
  });
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/app-shell.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — edit `src/components/dashboard/AppShell.tsx`:

3a. Tambah import (setelah baris `import type { OccupancyNotice } ...`):

```ts
import { ThemeContext, useTheme } from "./use-theme";
```

3b. Ganti `Nav` active/inactive class (baris 29):

```ts
            active
              ? "bg-brand-50 text-brand-500 dark:bg-brand-500/10 dark:text-brand-400"
              : "text-ta-gray-700 hover:bg-ta-gray-100 dark:text-ta-gray-300 dark:hover:bg-ta-gray-800",
```

3c. Ganti pembuka `return` komponen `AppShell` (baris 57-59) — tambah `theme` + provider + class `dark`:

```tsx
  const [open, setOpen] = useState(false);
  const theme = useTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <div
        className={cn(
          "min-h-[100svh] bg-ta-gray-50 font-outfit text-ta-gray-900 dark:bg-ta-gray-900 dark:text-ta-gray-100",
          theme.isDark && "dark",
        )}
      >
        <div className="md:flex">
```

3d. Ganti penutup (baris 116-118) — tutup provider:

```tsx
        </div>
      </div>
    </ThemeContext.Provider>
  );
```

3e. Drawer panel (baris 78): `bg-white` → `bg-white dark:bg-ta-gray-800`. Tombol tutup X (baris 82): `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`.

3f. Aside (baris 91): `border-ta-gray-200 bg-white` → `border-ta-gray-200 bg-white dark:border-ta-gray-700 dark:bg-ta-gray-800`.

3g. Header (baris 98): `border-ta-gray-200 bg-white/95` → `border-ta-gray-200 bg-white/95 dark:border-ta-gray-700 dark:bg-ta-gray-800/95`. h1 (baris 99): `text-ta-gray-900` → `text-ta-gray-900 dark:text-white`.

3h. Notice banner (baris 104): `border-brand-100 bg-brand-50` → `border-brand-100 bg-brand-50 dark:border-ta-gray-700 dark:bg-brand-500/10`. Teks (baris 105): `text-brand-700` → `text-brand-700 dark:text-brand-300`.

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/app-shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/AppShell.tsx tests/app-shell.test.ts
git commit -m "feat(theme): AppShell owns ThemeContext, applies .dark, adds dark variants"
```

---

## Task 9: Varian `dark:` di primitif `dashboard/ui.tsx`

**Files:**
- Modify: `src/components/dashboard/ui.tsx`
- Test: `tests/dashboard-ui.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `describe` utama di `tests/dashboard-ui.test.ts`:

```ts
  it("primitives carry dark-mode variants", () => {
    const s = src();
    expect(s).toContain("dark:bg-ta-gray-800");
    expect(s).toContain("dark:border-ta-gray-700");
    expect(s).toContain("dark:text-white");
    expect(taControlClass).toContain("dark:bg-ta-gray-900");
    expect(taSecondaryButtonClass).toContain("dark:bg-ta-gray-800");
  });
```

> Kalau `tests/dashboard-ui.test.ts` belum punya helper `src()`/import `taControlClass`, tambahkan di atas file: `const src = () => readFileSync(new URL("../src/components/dashboard/ui.tsx", import.meta.url), "utf8");` dan perluas import baris `from "../src/components/dashboard/ui"` agar menyertakan `taControlClass, taSecondaryButtonClass`.

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/dashboard-ui.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — edit `src/components/dashboard/ui.tsx` (ganti string persis):

3a. `taControlClass` — tambah di akhir string:
` dark:border-ta-gray-700 dark:bg-ta-gray-900 dark:text-ta-gray-100 dark:placeholder:text-ta-gray-500 disabled:dark:bg-ta-gray-800`

3b. `taSecondaryButtonClass` — tambah:
` dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-200 dark:hover:bg-ta-gray-700`

3c. `TaPageHeader` eyebrow `text-brand-500` → `text-brand-500 dark:text-brand-400`; h1 `text-ta-gray-900` → `text-ta-gray-900 dark:text-white`; description `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`.

3d. `TaCard` root `border-ta-gray-200 bg-white` → `border-ta-gray-200 bg-white dark:border-ta-gray-700 dark:bg-ta-gray-800`; header `border-ta-gray-100` → `border-ta-gray-100 dark:border-ta-gray-700`; title `text-ta-gray-900` → `text-ta-gray-900 dark:text-white`; desc `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`.

3e. `TaStatCard` root `border-ta-gray-200 bg-white` → `border-ta-gray-200 bg-white dark:border-ta-gray-700 dark:bg-ta-gray-800`; label `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`; value `text-ta-gray-900` → `text-ta-gray-900 dark:text-white`.

3f. `TaField` label `text-ta-gray-700` → `text-ta-gray-700 dark:text-ta-gray-300`; hint `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`.

3g. `BADGE_TONES` — ganti tiap nilai:
```ts
  success: "bg-ta-success/10 text-ta-success dark:text-[#34d399]",
  danger: "bg-ta-error/10 text-ta-error dark:text-[#f97066]",
  warning: "bg-ta-warning/10 text-ta-warning dark:text-[#f9b949]",
  info: "bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400",
  neutral: "bg-ta-gray-100 text-ta-gray-600 dark:bg-ta-gray-700 dark:text-ta-gray-300",
```

3h. `NOTICE_TONES` — ganti tiap nilai:
```ts
  danger: "border-ta-error/30 bg-ta-error/10 text-ta-error dark:text-[#fda29b]",
  warning: "border-ta-warning/30 bg-ta-warning/10 text-ta-warning dark:text-[#fecd6b]",
  success: "border-ta-success/30 bg-ta-success/10 text-ta-success dark:text-[#47cd8f]",
  neutral: "border-ta-gray-200 bg-ta-gray-50 text-ta-gray-600 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300",
```

3i. `TaEmpty` root `border-ta-gray-300 bg-ta-gray-25` → `border-ta-gray-300 bg-ta-gray-25 dark:border-ta-gray-700 dark:bg-ta-gray-800`; inner `bg-white ... ring-ta-gray-200` → tambah ` dark:bg-ta-gray-700 dark:ring-ta-gray-600`; title `text-ta-gray-800` → `text-ta-gray-800 dark:text-ta-gray-100`; desc `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`.

3j. `TaLoading` `text-ta-gray-500` → `text-ta-gray-500 dark:text-ta-gray-400`.

3k. `TaPagination` nav `border-ta-gray-200 bg-white` → `border-ta-gray-200 bg-white dark:border-ta-gray-700 dark:bg-ta-gray-800`; page label `text-ta-gray-600` → `text-ta-gray-600 dark:text-ta-gray-300`.

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/dashboard-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ui.tsx tests/dashboard-ui.test.ts
git commit -m "feat(theme): dark-mode variants across dashboard primitives"
```

---

## Task 10: Sidebar nama resto 1 baris + rapatkan

**Files:**
- Modify: `src/components/ManagerLayout.tsx:48-49`
- Test: `tests/manager-layout.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `describe("ManagerLayout (TailAdmin)", ...)` di `tests/manager-layout.test.ts`:

```ts
  it("keeps the restaurant name on one line, tight to the domain", () => {
    const text = source();
    expect(text).toContain("truncate");
    expect(text).toContain("whitespace-nowrap");
    expect(text).toContain("mt-0.5");
  });
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — ganti baris 48-49 `src/components/ManagerLayout.tsx`:

```tsx
      <p className="truncate whitespace-nowrap text-[13px] font-bold uppercase text-ta-gray-900 dark:text-white">
        {restaurantName}
      </p>
      <p className="mt-0.5 flex items-center justify-center gap-1 text-[11px] text-ta-gray-400">
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ManagerLayout.tsx tests/manager-layout.test.ts
git commit -m "feat(manager): single-line restaurant name, tighter footer spacing"
```

---

## Task 11: Cluster header Manager + hapus reminder muter

**Files:**
- Modify: `src/routes/manager/index.tsx`
- Test: `tests/manager-dashboard-route.test.ts`

- [ ] **Step 1: Tulis tes gagal** — ganti SELURUH ISI `tests/manager-dashboard-route.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager dashboard route (TailAdmin)", () => {
  it("keeps core logic intact", () => {
    expect(text()).toContain("readManagerIdentity");
    expect(text()).toContain("useTableOccupancyRealtime");
    expect(text()).toContain("bind_manager_session_realtime");
    expect(text()).toContain("buildStaleNotices");
    expect(text()).toContain("activeStation");
    expect(text()).toContain("formatOccupancyNotice");
  });
  it("uses the TailAdmin shell + primitives + stat cards", () => {
    expect(text()).toContain("ManagerLayout");
    expect(text()).toContain("TaCard");
    expect(text()).toContain("TaStatCard");
    expect(text()).toContain("ToastSlot");
    expect(text()).not.toContain("CrewHeader");
    expect(text()).not.toContain("OwnerUi");
  });
  it("renders the header cluster (emblem, toggle, bell, profile)", () => {
    expect(text()).toContain("RoleEmblem");
    expect(text()).toContain("ThemeToggle");
    expect(text()).toContain("NotificationBell");
    expect(text()).toContain("ProfileMenu");
  });
  it("drops the rotating reminder line but keeps the Perlu Dicek stat", () => {
    expect(text()).not.toContain("rotateIndex");
    expect(text()).not.toContain("buildStaleReminders");
    expect(text()).toContain("Perlu Dicek");
    expect(text()).toContain("TABLE_COUNT");
    expect(text()).toContain("md:grid-cols-10");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — edit `src/routes/manager/index.tsx`:

3a. Baris 4 hapus `LogOut` import (tidak dipakai lagi): ganti `import { LogOut } from "lucide-react";` → hapus baris itu.

3b. Setelah baris 6 (`import { TaCard ... }`), tambah:

```ts
import { RoleEmblem } from "@/components/dashboard/RoleEmblem";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { NotificationBell } from "@/components/dashboard/NotificationBell";
import { ProfileMenu } from "@/components/dashboard/ProfileMenu";
```

3c. Baris 17 ganti:

```ts
import { buildStaleNotices } from "@/lib/manager-reminder";
```

3d. Baris 62 hapus `const [tick, setTick] = useState(0);`.

3e. Ganti efek tick (baris 76-84) — buang interval rotasi 7s:

```tsx
  // 1s tick recomputes stale-table ages locally.
  useEffect(() => {
    const a = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(a);
  }, []);
```

3f. Ganti blok reminders (baris 129-133):

```tsx
  const staleNotices = useMemo(() => {
    const tables = snapshot.data && snapshot.data.ok ? snapshot.data.tables : [];
    return buildStaleNotices(tables, now);
  }, [snapshot.data, now]);
```

3g. Ganti `headerRight={...}` (baris 151-160):

```tsx
      headerRight={
        <>
          <RoleEmblem label="MANAGER" />
          <ThemeToggle />
          <NotificationBell items={staleNotices} />
          <ProfileMenu name={identity.fullName} onLogout={logout} />
        </>
      }
```

3h. Hapus blok reminder muter (baris 168-172):

```tsx
      {reminder && (
        <div className="mb-4 overflow-hidden rounded-xl bg-ta-error px-3 py-2 text-white">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide">{reminder}</p>
        </div>
      )}
```

3i. Ganti nilai stat card (baris 187): `value={reminders.length}` → `value={staleNotices.length}`.

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/index.tsx tests/manager-dashboard-route.test.ts
git commit -m "feat(manager): header cluster (emblem/toggle/bell/profile); drop rotating reminder"
```

---

## Task 12: Cluster header Super Admin

**Files:**
- Modify: `src/routes/super-admin/route.tsx`
- Test: `tests/super-admin-shell.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `describe` utama di `tests/super-admin-shell.test.ts`:

```ts
  it("header has theme toggle + profile menu, no standalone logout button", () => {
    const s = src();
    expect(s).toContain("ThemeToggle");
    expect(s).toContain("ProfileMenu");
    expect(s).not.toContain("taSecondaryButtonClass");
  });
```

> Pastikan helper `src()` menunjuk ke `../src/routes/super-admin/route.tsx`. Kalau belum ada, tambah: `const src = () => readFileSync(new URL("../src/routes/super-admin/route.tsx", import.meta.url), "utf8");`

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npx vitest run tests/super-admin-shell.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — edit `src/routes/super-admin/route.tsx`:

3a. Baris 24 ganti import:

```ts
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { ProfileMenu } from "@/components/dashboard/ProfileMenu";
```

3b. Ganti `headerRight={...}` (baris 115-124):

```tsx
      headerRight={
        <>
          <ThemeToggle />
          <ProfileMenu name="Owner" onLogout={handleLogout} />
        </>
      }
```

- [ ] **Step 4: Jalankan, pastikan HIJAU**

Run: `npx vitest run tests/super-admin-shell.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/super-admin/route.tsx tests/super-admin-shell.test.ts
git commit -m "feat(super-admin): header theme toggle + profile menu"
```

---

## Task 13: Full quality gate + preview

**Files:** (tidak ada edit baru; verifikasi)

- [ ] **Step 1: Format**

Run: `npx prettier --write "src/**/*.{ts,tsx,css}" "tests/**/*.ts"`
Expected: tanpa error.

- [ ] **Step 2: Full gate**

Run: `npm run verify`
Expected: exit 0 (test + typecheck + lint + build). Kalau lint komplain `react-refresh/only-export-components` di file baru yang ekspor non-komponen (mis. `use-theme.ts`), tambahkan `/* eslint-disable react-refresh/only-export-components */` di atas file itu dan ulangi.

- [ ] **Step 3: Cek crew/owner tak berubah (regresi visual)**

Run: `npx vitest run tests/crew-header-notice.test.ts tests/owner-shell-source.test.ts`
Expected: PASS.

- [ ] **Step 4: Push branch (refresh preview) — hanya dengan izin user**

Run: `git push origin feat/tailadmin-theme`
Lalu cek: `vercel ls lihat-meja --scope gacoan1` sampai Preview `● Ready`.

---

## Self-Review

**Spec coverage:** emblem (T7/T11), dark toggle (T3/T4/T8/T11/T12), notif bell + `buildStaleNotices` + hapus reminder muter (T2/T5/T11), profil avatar+nama+ganti password placeholder+logout pindah (T6/T11/T12), emblem kiri toggle (T11 urutan), sidebar 1 baris (T10), dark varian primitif (T9), CSS selector (T1), persist localStorage (T3), crew/owner aman (T8 class di root AppShell + T13 regresi). Semua tertutup.

**Placeholder scan:** tak ada TBD/TODO; tiap langkah punya kode/perintah.

**Type consistency:** `StaleNotice`/`BellNotice` struktural sama (`{table:number; duration:string}`) → `buildStaleNotices` (T2) kompatibel dengan `NotificationBell items` (T5/T11). `useTheme`→`ThemeValue` dipakai konsisten di AppShell (T8) + `useThemeValue` di ThemeToggle (T4). `identity.fullName` (ManagerIdentity) untuk ProfileMenu (T11).
