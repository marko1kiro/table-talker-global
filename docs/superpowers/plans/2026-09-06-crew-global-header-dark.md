# SP2 — Crew Global Header + Full Dark Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasir/Satgas/Clear Up pakai header global (mobile-first: Logo | RoleEmblem+ThemeToggle+Bell+ProfileMenu) + dark mode penuh; bell crew = feed aktivitas saja.

**Architecture:** Ekstrak `ThemeFrame` (theme provider + `.dark`) dipakai `AppShell` + `CrewShell` baru. `CrewShell` = header sticky + kontainer mobile-first, isi `DashboardHeaderRight` (`stale: []`). Crew realtime → `useNotificationCenter`. Dark = varian `dark:` eksplisit di `OwnerUi`, `CrewTableSection`+button classes, `alert-dialog`, grid/list per-rute. `CrewHeader` component dihapus di akhir.

**Tech Stack:** React 19, TanStack, lucide-react, Tailwind (ta-* + `dark:`), Vitest source-assertion.

**Konvensi:** named imports only; `npx prettier --write <file>` tiap edit; `npm run verify` exit 0 sebelum push; push branch `feat/global-header-notification-center` (BUKAN main).

**Spec:** `docs/superpowers/specs/2026-09-06-crew-global-header-dark-design.md`

**Aturan dark (dipakai konsisten di semua task restyle):**
- `bg-white` → tambah `dark:bg-ta-gray-800`; `border-slate-200`/`border-slate-100` → `dark:border-ta-gray-700`.
- Teks `text-slate-900/950/800` → `dark:text-ta-gray-100`; `text-slate-500/600` → `dark:text-ta-gray-400`.
- Emerald (kosong): `bg-emerald-50 text-emerald-800 border-emerald-300` → `dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30`.
- Red (terisi/perlu dibersihkan): `bg-red-50 text-red-700 border-red-300` → `dark:bg-red-500/10 dark:text-red-300 dark:border-red-500/30`.
- Amber (escort/konfirmasi): `bg-amber-50 text-amber-800 border-amber-300` → `dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30`.
- `divide-slate-100` → `dark:divide-ta-gray-700`.

---

## Task 1: `ThemeFrame` + `AppShell` pakai frame

**Files:** Create `src/components/dashboard/ThemeFrame.tsx`; Modify `src/components/dashboard/AppShell.tsx`; Test `tests/theme-frame.test.ts`, `tests/app-shell.test.ts`.

- [ ] Step 1: Test MERAH — `tests/theme-frame.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = () => readFileSync(new URL("../src/components/dashboard/ThemeFrame.tsx", import.meta.url), "utf8");
describe("ThemeFrame", () => {
  it("provides theme context and flips .dark on its root", () => {
    const s = src();
    expect(s).toContain("ThemeContext.Provider");
    expect(s).toContain('isDark && "dark"');
    expect(s).toContain("useTheme");
  });
});
```
  Dan di `tests/app-shell.test.ts`, ubah test theme jadi: `expect(src()).toContain("ThemeFrame");` (AppShell delegasi ke frame), hapus assertion `ThemeContext.Provider`/`isDark && "dark"` dari AppShell (pindah ke frame).
- [ ] Step 2: Run `npx vitest run tests/theme-frame.test.ts tests/app-shell.test.ts` → FAIL.
- [ ] Step 3: Buat `ThemeFrame.tsx`:
```tsx
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ThemeContext, useTheme } from "./use-theme";

export function ThemeFrame({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ThemeContext.Provider value={theme}>
      <div
        className={cn(
          "min-h-[100svh] bg-ta-gray-50 font-outfit text-ta-gray-900 dark:bg-ta-gray-900 dark:text-ta-gray-100",
          theme.isDark && "dark",
        )}
      >
        {children}
      </div>
    </ThemeContext.Provider>
  );
}
```
- [ ] Step 4: `AppShell.tsx` — buang `useTheme`/`ThemeContext` impor + `const theme = useTheme()` + pembungkus `<ThemeContext.Provider>`/`<div className={cn(...isDark...)}>`. Ganti pembungkus luar `return (...)` jadi `<ThemeFrame>...</ThemeFrame>` (impor `ThemeFrame`). Isi di dalamnya (md:flex, aside, main) tetap.
- [ ] Step 5: `npx prettier --write src/components/dashboard/ThemeFrame.tsx src/components/dashboard/AppShell.tsx tests/theme-frame.test.ts tests/app-shell.test.ts && npx vitest run tests/theme-frame.test.ts tests/app-shell.test.ts` → PASS.
- [ ] Step 6: Commit `git add -A src/components/dashboard/ThemeFrame.tsx src/components/dashboard/AppShell.tsx tests/theme-frame.test.ts tests/app-shell.test.ts && git commit -m "refactor(theme): extract ThemeFrame; AppShell delegates"`.

---

## Task 2: `CrewShell`

**Files:** Create `src/components/dashboard/CrewShell.tsx`; Test `tests/crew-shell.test.ts`.

- [ ] Step 1: Test MERAH — `tests/crew-shell.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = () => readFileSync(new URL("../src/components/dashboard/CrewShell.tsx", import.meta.url), "utf8");
describe("CrewShell", () => {
  it("mobile-first header: logo + unified cluster, feed-only bell, no sidebar", () => {
    const s = src();
    expect(s).toContain("ThemeFrame");
    expect(s).toContain("lime-logo.webp");
    expect(s).toContain("DashboardHeaderRight");
    expect(s).toContain("stale: []");
    expect(s).not.toContain("md:flex");
  });
});
```
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Buat `CrewShell.tsx`:
```tsx
import type { ReactNode } from "react";
import { ThemeFrame } from "./ThemeFrame";
import { DashboardHeaderRight } from "./DashboardHeaderRight";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export function CrewShell({
  roleLabel,
  userName,
  onLogout,
  feed,
  unread,
  onOpen,
  children,
}: {
  roleLabel: string;
  userName: string;
  onLogout: () => void;
  feed: OccupancyNotice[];
  unread: number;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <ThemeFrame>
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-ta-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-ta-gray-700 dark:bg-ta-gray-800/95">
        <img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
        <DashboardHeaderRight
          roleLabel={roleLabel}
          profile={{ name: userName, canChangePassword: false }}
          notifications={{ stale: [], feed, unread, onOpen }}
          onLogout={onLogout}
        />
      </header>
      <main className="mx-auto w-full max-w-[720px] px-4 py-4">{children}</main>
    </ThemeFrame>
  );
}
```
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `git add src/components/dashboard/CrewShell.tsx tests/crew-shell.test.ts && git commit -m "feat(crew): CrewShell mobile-first global header (feed-only bell)"`.

---

## Task 3: `OwnerUi` dark variants

**Files:** Modify `src/components/OwnerUi.tsx`; Test `tests/owner-ui-dark.test.ts`.

- [ ] Step 1: Test MERAH — `tests/owner-ui-dark.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = () => readFileSync(new URL("../src/components/OwnerUi.tsx", import.meta.url), "utf8");
describe("OwnerUi dark", () => {
  it("adds dark variants to surfaces and tones", () => {
    const s = src();
    expect(s).toContain("dark:bg-ta-gray-800");
    expect(s).toContain("dark:border-ta-gray-700");
    expect(s).toContain("dark:text-ta-gray-100");
    expect(s).toContain("dark:text-ta-gray-400");
  });
});
```
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Terapkan aturan dark ke SEMUA di `OwnerUi.tsx`: `ownerControlClass`, `ownerPrimaryButtonClass`, `ownerSecondaryButtonClass`, `ownerDangerButtonClass`, `OwnerPageHeader`, `OwnerPanel`, `OwnerField`, `StatusBadge` (tiap tone), `OwnerNotice` (tiap tone), `OwnerLoading`, `OwnerEmpty`, `OwnerRetry`(via class), `OwnerPagination`. Contoh konkret:
  - `OwnerPanel`: `"rounded-2xl border border-slate-200 bg-white shadow-sm"` → tambah `dark:border-ta-gray-700 dark:bg-ta-gray-800`; judul `text-slate-950` → `dark:text-white`; desc `text-slate-500` → `dark:text-ta-gray-400`; border header `border-slate-100` → `dark:border-ta-gray-700`.
  - `OwnerNotice` tone danger: `"border-red-200 bg-red-50 text-red-800"` → tambah `dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300` (analog warning/success/neutral).
  - `StatusBadge` tones: tambah `dark:` tint sepadan.
  - `ownerPrimaryButtonClass`: `bg-slate-950 text-white` → `dark:bg-white dark:text-ta-gray-900` (invert) ATAU `dark:bg-ta-gray-100 dark:text-ta-gray-900`; hover amber → `dark:hover:bg-amber-400`.
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `git add src/components/OwnerUi.tsx tests/owner-ui-dark.test.ts && git commit -m "feat(owner-ui): dark variants across crew primitives"`.

---

## Task 4: `CrewTableSection` + crew button classes dark

**Files:** Modify `src/components/CrewHeader.tsx` (HANYA `CrewTableSection` + `crewPrimaryButtonClass` + `crewSecondaryButtonClass` + `LEGEND_DOT_CLASS`; komponen `CrewHeader` disentuh di Task 9); Test `tests/crew-header.test.ts`.

- [ ] Step 1: Test MERAH — `tests/crew-header.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = () => readFileSync(new URL("../src/components/CrewHeader.tsx", import.meta.url), "utf8");
describe("CrewTableSection dark", () => {
  it("adds dark variants to the section card + buttons", () => {
    const s = src();
    expect(s).toContain("dark:bg-ta-gray-800");
    expect(s).toContain("dark:border-ta-gray-700");
  });
});
```
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Terapkan aturan dark ke `CrewTableSection` (section `bg-white border-slate-200`, header `border-slate-100`, judul `text-slate-900`, legend `text-slate-500`, toggle button `border-slate-200 bg-white text-slate-600`) + `crewPrimaryButtonClass` (`bg-slate-900 text-white` → `dark:bg-ta-gray-100 dark:text-ta-gray-900`) + `crewSecondaryButtonClass` (`border-slate-200 bg-white text-slate-700` → `dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-200`).
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `git add src/components/CrewHeader.tsx tests/crew-header.test.ts && git commit -m "feat(crew): dark variants for CrewTableSection + crew buttons"`.

---

## Task 5: `alert-dialog` dark variants

**Files:** Modify `src/components/ui/alert-dialog.tsx`; Test `tests/alert-dialog-dark.test.ts`.

- [ ] Step 1: Test MERAH — `tests/alert-dialog-dark.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = () => readFileSync(new URL("../src/components/ui/alert-dialog.tsx", import.meta.url), "utf8");
describe("alert-dialog dark", () => {
  it("has dark variants", () => {
    expect(src()).toContain("dark:");
  });
});
```
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: `AlertDialogContent`: tambah `dark:border-ta-gray-700` (bg sudah `bg-background` ikut `.dark`). `AlertDialogTitle`: `text-foreground` sudah oke; `AlertDialogDescription` `text-muted-foreground` → tambah `dark:text-ta-gray-400` bila `--muted-foreground` belum dark-aware. `AlertDialogOverlay` `bg-black/80` sudah oke.
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `git add src/components/ui/alert-dialog.tsx tests/alert-dialog-dark.test.ts && git commit -m "feat(ui): dark variants for alert-dialog"`.

---

## Task 6: Migrasi Kasir

**Files:** Modify `src/routes/kasir/index.tsx`; Test `tests/kasir-route.test.ts` (baru/perluas).

- [ ] Step 1: Test MERAH — `tests/kasir-route.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const src = () => readFileSync(new URL("../src/routes/kasir/index.tsx", import.meta.url), "utf8");
describe("kasir route (SP2)", () => {
  it("uses CrewShell + notification center, drops CrewHeader/useNoticeQueue, dark grid", () => {
    const s = src();
    expect(s).toContain("CrewShell");
    expect(s).toContain("useNotificationCenter");
    expect(s).not.toContain("CrewHeader");
    expect(s).not.toContain("useNoticeQueue");
    expect(s).toContain('roleLabel="KASIR"');
    expect(s).toContain("dark:bg-emerald-500/10");
  });
});
```
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Edit `kasir/index.tsx`:
  - impor: buang `CrewHeader` (dari `@/components/CrewHeader` — tetap impor `CrewTableSection`, `crewPrimaryButtonClass`, `crewSecondaryButtonClass`), buang `useNoticeQueue`; tambah `CrewShell` (`@/components/dashboard/CrewShell`) + `useNotificationCenter` (`@/hooks/use-notification-center`).
  - `const notices = useNoticeQueue();` → `const { items, unread, push, markRead } = useNotificationCenter();`.
  - callback: `if (notice) notices.push(notice);` → `if (notice) push(notice);`.
  - Root return: ganti `<div className="mx-auto w-full max-w-[1440px] sm:px-6 sm:py-2 lg:px-10 lg:py-4"><OwnerPage><CrewHeader .../>` menjadi `<CrewShell roleLabel="KASIR" userName={identity.displayName} onLogout={logout} feed={items} unread={unread} onOpen={markRead}><OwnerPage>` (buang `<CrewHeader>` + `<div max-w>` pembungkus). Tutup `</OwnerPage></CrewShell>`.
  - `TableGrid`/`TableList`: terapkan aturan dark ke state emerald (kosong) + red (terisi) + pending.
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `git add src/routes/kasir/index.tsx tests/kasir-route.test.ts && git commit -m "feat(kasir): CrewShell + notification center + dark grid"`.

---

## Task 7: Migrasi Clear Up

**Files:** Modify `src/routes/clear-up/index.tsx`; Test `tests/clear-up-route.test.ts`.

- [ ] Step 1: Test MERAH — `tests/clear-up-route.test.ts` (analog Task 6): `toContain("CrewShell")`, `useNotificationCenter`, `not.toContain("CrewHeader")`, `not.toContain("useNoticeQueue")`, `roleLabel="CLEAR UP"`, `dark:bg-red-500/10`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Edit `clear-up/index.tsx` seperti Task 6 (root `<OwnerPage>` → `<CrewShell roleLabel="CLEAR UP" ...><OwnerPage>...</OwnerPage></CrewShell>`; hook; callback; `TableGrid`/`TableList` red queue → dark).
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `... -m "feat(clear-up): CrewShell + notification center + dark grid"`.

---

## Task 8: Migrasi Satgas (+ escort panel/dialog dark)

**Files:** Modify `src/routes/satgas/index.tsx`; Test `tests/satgas-route.test.ts`.

- [ ] Step 1: Test MERAH — `tests/satgas-route.test.ts`: `toContain("CrewShell")`, `useNotificationCenter`, `not.toContain("CrewHeader")`, `not.toContain("useNoticeQueue")`, `roleLabel="SATGAS"`, `dark:bg-amber-500/10`, `dark:bg-emerald-500/10`.
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Edit `satgas/index.tsx` seperti Task 6/7 + ekstra: panel "Menunggu Konfirmasi" (`bg-amber-50 border-amber-300 text-amber-800`) → dark; `TableGrid`/`TableList` state emerald/amber/red → dark; dialog escort/cancel (pakai `crew*ButtonClass` + `alert-dialog` yang sudah dark).
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `... -m "feat(satgas): CrewShell + notification center + dark grid/escort"`.

---

## Task 9: Hapus komponen `CrewHeader`

**Files:** Modify `src/components/CrewHeader.tsx`.

- [ ] Step 1: Konfirmasi tak ada konsumen: `rg -n "CrewHeader\b" src/` → hanya definisi (route sudah dimigrasi). Kalau masih ada, STOP (berarti migrasi bolong).
- [ ] Step 2: Hapus fungsi `CrewHeader` + impor tak terpakai (`formatRestaurantLabel`, `OccupancyNotice` bila tak dipakai `CrewTableSection`). Sisakan `LEGEND_DOT_CLASS`, `crewPrimaryButtonClass`, `crewSecondaryButtonClass`, `CrewTableSection`.
- [ ] Step 3: `npx tsc --noEmit` (atau `npm run typecheck`) → bersih.
- [ ] Step 4: Commit `git add src/components/CrewHeader.tsx && git commit -m "refactor(crew): remove CrewHeader (replaced by CrewShell)"`.

---

## Task 10: Full quality gate + push

- [ ] Step 1: `npm run verify` → exit 0. Perbaiki sisa (impor unused, assertion lama crew yang cek `CrewHeader`/`useNoticeQueue`/`notice=` di test rute crew lama → update).
- [ ] Step 2: `git add -A && git commit -m "chore: satisfy quality gate for SP2 crew header + dark"` (bila ada perubahan).
- [ ] Step 3: `git push` (branch sudah tracking).

---

## Self-Review (penulis plan)

- **Cakupan spec:** ThemeFrame (T1), CrewShell (T2), OwnerUi dark (T3), CrewTableSection dark (T4), alert-dialog dark (T5), kasir/clear-up/satgas migrasi+dark (T6-8), hapus CrewHeader (T9), gate+push (T10). Semua butir spec ada task.
- **Placeholder:** aturan dark didefinisikan sekali di atas lalu dipakai konsisten (bukan "TODO"); tiap task uji punya assertion konkret.
- **Konsistensi:** `CrewShell` props (T2) = pemakaian T6-8; `useNotificationCenter` API (SP1) dipakai crew; `stale: []` crew (T2) sesuai keputusan; label `KASIR/SATGAS/CLEAR UP` konsisten test+impl.
- **Urutan aman:** CrewHeader dihapus (T9) SETELAH semua rute migrasi (T6-8) → tak ada dangling import.
