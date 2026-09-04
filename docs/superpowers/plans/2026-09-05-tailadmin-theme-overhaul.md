# TailAdmin Theme Overhaul (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Manager dashboard and the Super Admin console to the TailAdmin design language (sidebar + top header + dashboard layout + core components), UI/UX only.

**Architecture:** Add TailAdmin design tokens to `styles.css` (additive, new names). Build a new presentational component set under `src/components/dashboard/` — `AppShell` (sidebar + header + notice banner + mobile drawer) and `ui.tsx` primitives that MIRROR the `OwnerUi` API. Migrate Manager and Super Admin onto them. `OwnerUi.tsx`, `CrewHeader.tsx`, `Header.tsx`, all crew routes, and every server fn / RPC / migration / hook stay untouched.

**Tech Stack:** TanStack Start + Router (file routes), TanStack Query, React 19, Tailwind v4 (`@theme`), lucide-react, Vitest (source-contract tests). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-05-tailadmin-theme-overhaul-design.md`

**Branch:** `feat/tailadmin-theme`. **UI-only rule:** never change data fetching, realtime, reminder, auth, or RPC wiring — only JSX structure and Tailwind classes. **Gate:** `npm run verify` exit 0 before each commit; run `npx prettier --write` after PowerShell edits.

---

## File Structure

- `src/styles.css` — MODIFY: add TailAdmin `@theme` tokens + Outfit import.
- `src/components/dashboard/ui.tsx` — CREATE: `TaPage`, `TaPageHeader`, `TaCard`, `TaField`, `TaNotice`, `TaEmpty`, `TaLoading`, `TaRetry`, `TaPagination`, `TaBadge`, `TaStatCard`, `taControlClass`, `taPrimaryButtonClass`, `taSecondaryButtonClass`, `taDangerButtonClass`.
- `src/components/dashboard/AppShell.tsx` — CREATE: sidebar + sticky header + notice banner + mobile drawer.
- `src/components/ManagerLayout.tsx` — MODIFY: render `AppShell`.
- `src/routes/manager/index.tsx` — MODIFY: `AppShell` + `Ta*` + stat-card row (logic unchanged).
- `src/routes/super-admin/route.tsx` — MODIFY: render `AppShell` (auth logic unchanged).
- `src/routes/super-admin/{index,restaurants/index,restaurants/$id,audio,history,error-log,esb-export,managers}.tsx` — MODIFY: swap `OwnerUi` imports → `dashboard/ui` (mechanical).
- Tests: `tailadmin-tokens.test.ts`, `dashboard-ui.test.ts`, `app-shell.test.ts`, `manager-shell.test.ts`, `super-admin-shell.test.ts`; update `manager-layout.test.ts`, `manager-dashboard-route.test.ts`, `super-admin-route.test.ts`.

## OwnerUi → Ta migration mapping (used by every page task)

| OwnerUi symbol | New symbol (`@/components/dashboard/ui`) |
| --- | --- |
| `OwnerPage` | `TaPage` |
| `OwnerPageHeader` | `TaPageHeader` |
| `OwnerPanel` | `TaCard` |
| `OwnerField` | `TaField` |
| `OwnerNotice` | `TaNotice` |
| `OwnerEmpty` | `TaEmpty` |
| `OwnerLoading` | `TaLoading` |
| `OwnerRetry` | `TaRetry` |
| `OwnerPagination` | `TaPagination` |
| `StatusBadge` | `TaBadge` |
| `ownerControlClass` | `taControlClass` |
| `ownerPrimaryButtonClass` | `taPrimaryButtonClass` |
| `ownerSecondaryButtonClass` | `taSecondaryButtonClass` |
| `ownerDangerButtonClass` | `taDangerButtonClass` |
| `formatOwnerDate` | (unchanged — keep importing from `@/components/OwnerUi`; it is a pure util) |

Prop shapes are identical, so each page change is: edit the import block + rename usages. No JSX/logic edits.

---

## Task 1: TailAdmin design tokens

**Files:**
- Modify: `src/styles.css`
- Test: `tests/tailadmin-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/tailadmin-tokens.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = () =>
  readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("TailAdmin tokens", () => {
  it("adds brand + ta-gray + status + shadow tokens and Outfit", () => {
    const s = css();
    expect(s).toContain("--color-brand-500:#465fff");
    expect(s).toContain("--color-brand-50:#ecf3ff");
    expect(s).toContain("--color-ta-gray-50:#f9fafb");
    expect(s).toContain("--color-ta-gray-200:#e4e7ec");
    expect(s).toContain("--color-ta-success:#12b76a");
    expect(s).toContain("--color-ta-error:#f04438");
    expect(s).toContain("--shadow-theme-sm:");
    expect(s).toContain("--font-outfit:");
    expect(s).toContain("family=Outfit");
  });
  it("keeps the existing neo-brutalism tokens (crew/SS untouched)", () => {
    const s = css();
    expect(s).toContain("--brutal-bg");
    expect(s).toContain("--font-display");
    expect(s).toContain("brutal-border");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tailadmin-tokens.test.ts`
Expected: FAIL (tokens absent).

- [ ] **Step 3: Add tokens**

In `src/styles.css`, add at the very top (before `@import "tailwindcss"`):
```css
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap") layer(base);
```
Inside the existing `@theme inline { ... }` block, append:
```css
  --font-outfit: "Outfit", sans-serif;
  --color-brand-50:#ecf3ff; --color-brand-100:#dde9ff; --color-brand-200:#c2d6ff;
  --color-brand-300:#9cb9ff; --color-brand-400:#7592ff; --color-brand-500:#465fff;
  --color-brand-600:#3641f5; --color-brand-700:#2a31d8;
  --color-ta-gray-25:#fcfcfd; --color-ta-gray-50:#f9fafb; --color-ta-gray-100:#f2f4f7;
  --color-ta-gray-200:#e4e7ec; --color-ta-gray-300:#d0d5dd; --color-ta-gray-400:#98a2b3;
  --color-ta-gray-500:#667085; --color-ta-gray-600:#475467; --color-ta-gray-700:#344054;
  --color-ta-gray-800:#1d2939; --color-ta-gray-900:#101828;
  --color-ta-success:#12b76a; --color-ta-error:#f04438; --color-ta-warning:#f79009;
  --shadow-theme-xs:0 1px 2px rgba(16,24,40,.05);
  --shadow-theme-sm:0 1px 3px rgba(16,24,40,.1),0 1px 2px rgba(16,24,40,.06);
  --shadow-theme-md:0 4px 8px -2px rgba(16,24,40,.1),0 2px 4px -2px rgba(16,24,40,.06);
```
Do NOT remove or edit any existing token/utility.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tailadmin-tokens.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/styles.css tests/tailadmin-tokens.test.ts
git commit -m "feat(theme): add TailAdmin design tokens (brand/ta-gray/status/shadow/Outfit)"
```

---

## Task 2: TailAdmin UI primitives (`dashboard/ui.tsx`)

**Files:**
- Create: `src/components/dashboard/ui.tsx`
- Test: `tests/dashboard-ui.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/dashboard-ui.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/ui.tsx", import.meta.url), "utf8");

describe("dashboard/ui primitives", () => {
  it("exports the OwnerUi-mirror set + stat card", () => {
    const s = src();
    for (const name of [
      "TaPage","TaPageHeader","TaCard","TaField","TaNotice","TaEmpty",
      "TaLoading","TaRetry","TaPagination","TaBadge","TaStatCard",
      "taControlClass","taPrimaryButtonClass","taSecondaryButtonClass","taDangerButtonClass",
    ]) {
      expect(s).toContain(name);
    }
  });
  it("uses brand + ta-gray tokens, not amber", () => {
    const s = src();
    expect(s).toContain("bg-brand-500");
    expect(s).toContain("border-ta-gray-200");
    expect(s).not.toContain("amber");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dashboard-ui.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write minimal implementation**

`src/components/dashboard/ui.tsx`:
```tsx
/* eslint-disable react-refresh/only-export-components */
import type { ReactNode } from "react";
import { AlertTriangle, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

export const taControlClass =
  "mt-1.5 min-h-11 w-full rounded-lg border border-ta-gray-300 bg-white px-3.5 py-2.5 text-sm text-ta-gray-900 outline-none transition placeholder:text-ta-gray-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 disabled:cursor-not-allowed disabled:bg-ta-gray-100 disabled:text-ta-gray-400";

export const taPrimaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-theme-sm transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:pointer-events-none disabled:opacity-45";

export const taSecondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-ta-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-ta-gray-700 transition hover:bg-ta-gray-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ta-gray-200 disabled:pointer-events-none disabled:opacity-45";

export const taDangerButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-ta-error px-4 py-2.5 text-sm font-semibold text-white shadow-theme-sm transition hover:bg-error-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ta-error/25 disabled:pointer-events-none disabled:opacity-45";

export function TaPage({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}

export function TaPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-500">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-bold tracking-tight text-ta-gray-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-ta-gray-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

export function TaCard({
  children,
  className,
  title,
  description,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-ta-gray-200 bg-white shadow-theme-sm", className)}
    >
      {(title || description) && (
        <div className="border-b border-ta-gray-100 px-5 py-4">
          {title && <h2 className="text-base font-semibold text-ta-gray-900">{title}</h2>}
          {description && <p className="mt-1 text-sm text-ta-gray-500">{description}</p>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function TaStatCard({
  label,
  value,
  icon: Icon,
  tone = "bg-brand-50 text-brand-500",
}: {
  label: string;
  value: ReactNode;
  icon?: typeof Inbox;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-ta-gray-200 bg-white p-5 shadow-theme-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ta-gray-500">{label}</p>
        {Icon && (
          <span className={cn("grid size-9 place-items-center rounded-lg", tone)}>
            <Icon className="size-5" />
          </span>
        )}
      </div>
      <p className="mt-3 text-3xl font-bold tracking-tight text-ta-gray-900">{value}</p>
    </div>
  );
}

export function TaField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-sm font-medium text-ta-gray-700">
      {label}
      {children}
      {hint && <span className="mt-1.5 block text-xs font-normal text-ta-gray-500">{hint}</span>}
    </label>
  );
}

const BADGE_TONES = {
  success: "bg-[color-mix(in_oklab,var(--color-ta-success)_12%,white)] text-ta-success",
  danger: "bg-[color-mix(in_oklab,var(--color-ta-error)_12%,white)] text-ta-error",
  warning: "bg-[color-mix(in_oklab,var(--color-ta-warning)_14%,white)] text-ta-warning",
  info: "bg-brand-50 text-brand-500",
  neutral: "bg-ta-gray-100 text-ta-gray-600",
} as const;

export function TaBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONES;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

const NOTICE_TONES = {
  danger: "border-ta-error/30 bg-[color-mix(in_oklab,var(--color-ta-error)_8%,white)] text-ta-error",
  warning:
    "border-ta-warning/40 bg-[color-mix(in_oklab,var(--color-ta-warning)_10%,white)] text-ta-warning",
  success:
    "border-ta-success/30 bg-[color-mix(in_oklab,var(--color-ta-success)_8%,white)] text-ta-success",
  neutral: "border-ta-gray-200 bg-ta-gray-50 text-ta-gray-600",
} as const;

export function TaNotice({
  children,
  tone = "neutral",
  role,
}: {
  children: ReactNode;
  tone?: keyof typeof NOTICE_TONES;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-medium",
        NOTICE_TONES[tone],
      )}
    >
      {tone === "danger" && <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
      <div>{children}</div>
    </div>
  );
}

export function TaLoading({ label = "Memuat data..." }: { label?: string }) {
  return (
    <TaCard>
      <div role="status" className="flex min-h-48 flex-col items-center justify-center gap-3 text-ta-gray-500">
        <LoaderCircle className="size-6 animate-spin text-brand-500" />
        <p className="text-sm font-medium">{label}</p>
      </div>
    </TaCard>
  );
}

export function TaEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-ta-gray-300 bg-ta-gray-25 px-6 text-center">
      <span className="mb-3 grid size-10 place-items-center rounded-lg bg-white text-ta-gray-400 shadow-theme-xs ring-1 ring-ta-gray-200">
        <Inbox className="size-5" />
      </span>
      <p className="font-semibold text-ta-gray-800">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-ta-gray-500">{description}</p>
    </div>
  );
}

export function TaRetry({ onClick, label = "Coba lagi" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className={taSecondaryButtonClass}>
      <RefreshCw className="size-4" />
      {label}
    </button>
  );
}

export function TaPagination({
  page,
  hasNext,
  onPrevious,
  onNext,
  previousLabel = "Sebelumnya",
  nextLabel = "Berikutnya",
}: {
  page: number;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  previousLabel?: string;
  nextLabel?: string;
}) {
  return (
    <nav
      aria-label="Paginasi"
      className="flex flex-col gap-3 rounded-lg border border-ta-gray-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <button type="button" disabled={page === 1} onClick={onPrevious} className={taSecondaryButtonClass}>
        {previousLabel}
      </button>
      <span className="text-center text-sm font-semibold text-ta-gray-600">Halaman {page}</span>
      <button type="button" disabled={!hasNext} onClick={onNext} className={taSecondaryButtonClass}>
        {nextLabel}
      </button>
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dashboard-ui.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ui.tsx tests/dashboard-ui.test.ts
git commit -m "feat(theme): add TailAdmin UI primitives mirroring the OwnerUi API"
```

---

## Task 3: `AppShell` (sidebar + header + notice banner + mobile drawer)

**Files:**
- Create: `src/components/dashboard/AppShell.tsx`
- Test: `tests/app-shell.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/app-shell.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/AppShell.tsx", import.meta.url), "utf8");

describe("AppShell", () => {
  it("renders a light sidebar with brand-blue active items", () => {
    const s = src();
    expect(s).toContain("bg-white");
    expect(s).toContain("bg-brand-50");
    expect(s).toContain("text-brand-500");
    expect(s).toContain("text-ta-gray-700");
  });
  it("has a sticky header and a notice banner slot", () => {
    const s = src();
    expect(s).toContain("sticky top-0");
    expect(s).toContain("notice");
  });
  it("is responsive (desktop rail + mobile drawer)", () => {
    const s = src();
    expect(s).toContain("md:flex");
    expect(s).toContain("md:hidden");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/app-shell.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Write minimal implementation**

`src/components/dashboard/AppShell.tsx`:
```tsx
import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export type AppShellNavItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onSelect: () => void;
};

function Nav({
  items,
  onNavigate,
}: {
  items: AppShellNavItem[];
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ id, label, icon: Icon, active, onSelect }) => (
        <button
          key={id}
          type="button"
          aria-current={active ? "page" : undefined}
          onClick={() => {
            onSelect();
            onNavigate?.();
          }}
          className={cn(
            "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
            active ? "bg-brand-50 text-brand-500" : "text-ta-gray-700 hover:bg-ta-gray-100",
          )}
        >
          <Icon className="size-[18px] shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function AppShell({
  brand,
  navItems,
  headerTitle,
  headerRight,
  notice,
  footer,
  children,
}: {
  brand: ReactNode;
  navItems: AppShellNavItem[];
  headerTitle: string;
  headerRight?: ReactNode;
  notice?: OccupancyNotice | null;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-[100svh] bg-ta-gray-50 font-outfit text-ta-gray-900">
      <div className="md:flex">
        <button
          type="button"
          aria-label="Buka menu"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 left-4 z-40 flex size-12 items-center justify-center rounded-full bg-brand-500 text-white shadow-theme-md md:hidden"
        >
          <Menu className="size-6" />
        </button>

        {open && (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label="Tutup menu"
              className="absolute inset-0 bg-ta-gray-900/40"
              onClick={() => setOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white p-4 shadow-theme-xl">
              <div className="mb-6 flex items-center justify-between">
                {brand}
                <button type="button" aria-label="Tutup" onClick={() => setOpen(false)}>
                  <X className="size-5 text-ta-gray-500" />
                </button>
              </div>
              <Nav items={navItems} onNavigate={() => setOpen(false)} />
              {footer && <div className="mt-auto pt-4">{footer}</div>}
            </div>
          </div>
        )}

        <aside className="hidden md:flex md:sticky md:top-0 md:h-[100svh] w-64 shrink-0 flex-col overflow-y-auto border-r border-ta-gray-200 bg-white p-4">
          <div className="mb-6 flex h-14 items-center justify-center">{brand}</div>
          <Nav items={navItems} />
          {footer && <div className="mt-auto pt-4">{footer}</div>}
        </aside>

        <main className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ta-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
            <h1 className="truncate text-base font-semibold text-ta-gray-900">{headerTitle}</h1>
            <div className="flex shrink-0 items-center gap-2">{headerRight}</div>
          </header>

          {notice && (
            <div className="border-b border-brand-100 bg-brand-50 px-4 py-2 sm:px-6">
              <p className="truncate text-sm font-semibold uppercase text-brand-700">
                {notice.line1}
                <span className="ml-2 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold text-white">
                  {notice.roleLabel}
                </span>
              </p>
            </div>
          )}

          <div className="w-full px-4 py-5 sm:px-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/app-shell.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/AppShell.tsx tests/app-shell.test.ts
git commit -m "feat(theme): add TailAdmin AppShell (sidebar + header + notice banner)"
```

---

## Task 4: Manager layout onto AppShell

**Files:**
- Modify: `src/components/ManagerLayout.tsx`
- Test: `tests/manager-layout.test.ts` (update)

- [ ] **Step 1: Update the failing test**

Replace `tests/manager-layout.test.ts` with:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/ManagerLayout.tsx", import.meta.url), "utf8");

describe("ManagerLayout (TailAdmin)", () => {
  it("delegates to AppShell with the three menus", () => {
    const text = source();
    expect(text).toContain("AppShell");
    expect(text).toContain("LIHAT STATUS MEJA LIVE");
    expect(text).toContain("LIHAT CREW AKTIF");
    expect(text).toContain("LOG AKTIVITAS CREW");
  });
  it("keeps the RGB neon DASHBOARD brand", () => {
    const text = source();
    expect(text).toContain("DASHBOARD");
    expect(text).toContain("bg-clip-text");
    expect(text).toContain("from-red");
  });
  it("keeps the footer branding with a copyright glyph", () => {
    const text = source();
    expect(text).toContain("©");
    expect(text).toContain("XDIRGA LABS");
    expect(text).not.toContain("MIE GACOAN");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: FAIL (no `AppShell` reference yet).

- [ ] **Step 3: Rewrite ManagerLayout**

`src/components/ManagerLayout.tsx`:
```tsx
import type { ReactNode } from "react";
import { Table2, Users, ScrollText } from "lucide-react";
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export type ManagerMenu = "tables" | "crew" | "log";

const ICONS = { tables: Table2, crew: Users, log: ScrollText } as const;
const LABELS: { id: ManagerMenu; label: string }[] = [
  { id: "tables", label: "LIHAT STATUS MEJA LIVE" },
  { id: "crew", label: "LIHAT CREW AKTIF" },
  { id: "log", label: "LOG AKTIVITAS CREW" },
];

function Brand() {
  return (
    <span className="bg-gradient-to-r from-red-500 via-green-500 to-blue-500 bg-clip-text text-lg font-black uppercase tracking-[0.25em] text-transparent">
      DASHBOARD
    </span>
  );
}

export function ManagerLayout({
  restaurantName,
  active,
  onSelect,
  notice,
  headerRight,
  children,
}: {
  restaurantName: string;
  active: ManagerMenu;
  onSelect: (m: ManagerMenu) => void;
  notice?: OccupancyNotice | null;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  const navItems: AppShellNavItem[] = LABELS.map(({ id, label }) => ({
    id,
    label,
    icon: ICONS[id],
    active: active === id,
    onSelect: () => onSelect(id),
  }));
  const headerTitle = LABELS.find((l) => l.id === active)?.label ?? "Dashboard";
  const footer = (
    <div className="rounded-xl border border-ta-gray-200 bg-white p-4 text-center">
      <p className="text-sm font-bold uppercase text-ta-gray-900">{restaurantName}</p>
      <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-ta-gray-400">
        lihatmeja.com <span aria-label="copyright">©</span> 2026
      </p>
      <p className="text-[11px] font-bold uppercase tracking-wide text-ta-gray-400">XDIRGA LABS</p>
    </div>
  );
  return (
    <AppShell
      brand={<Brand />}
      navItems={navItems}
      headerTitle={headerTitle}
      headerRight={headerRight}
      notice={notice}
      footer={footer}
    >
      {children}
    </AppShell>
  );
}
```

Note: `ManagerLayout` now takes `notice` + `headerRight` (was `header`). Task 5 updates the caller.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ManagerLayout.tsx tests/manager-layout.test.ts
git commit -m "feat(theme): rebuild ManagerLayout on the TailAdmin AppShell"
```

---

## Task 5: Manager dashboard route onto AppShell + stat cards

**Files:**
- Modify: `src/routes/manager/index.tsx`
- Test: `tests/manager-dashboard-route.test.ts` (update)

- [ ] **Step 1: Update the failing test**

Replace `tests/manager-dashboard-route.test.ts` with:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager dashboard route (TailAdmin)", () => {
  it("keeps all core logic intact", () => {
    expect(text()).toContain("readManagerIdentity");
    expect(text()).toContain("useTableOccupancyRealtime");
    expect(text()).toContain("bind_manager_session_realtime");
    expect(text()).toContain("buildStaleReminders");
    expect(text()).toContain("activeStation");
    expect(text()).toContain("formatOccupancyNotice");
  });
  it("uses the TailAdmin shell + primitives + stat cards", () => {
    expect(text()).toContain("ManagerLayout");
    expect(text()).toContain("TaCard");
    expect(text()).toContain("TaStatCard");
    expect(text()).not.toContain("CrewHeader");
    expect(text()).not.toContain("OwnerUi");
  });
  it("keeps the reminder banner + full table grid", () => {
    expect(text()).toContain("reminder");
    expect(text()).toContain("TABLE_COUNT");
    expect(text()).toContain("md:grid-cols-10");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: FAIL (still imports CrewHeader/OwnerUi).

- [ ] **Step 3: Rewrite the route's presentation only**

Edit `src/routes/manager/index.tsx`:
- Remove `import { CrewHeader }` and `import { OwnerEmpty, OwnerNotice, OwnerRetry } from "@/components/OwnerUi"`.
- Add `import { TaCard, TaNotice, TaEmpty, TaRetry, TaStatCard } from "@/components/dashboard/ui";` and `import { LogOut } from "lucide-react";`.
- Keep ALL state, effects, queries, `realtimeStatus`, `reminders`, `reminder`, `logout`, `statusByNumber`, `activeStation` logic byte-for-byte.
- Replace the `<ManagerLayout ... header={<CrewHeader .../>}>` usage with the new props:
```tsx
    <ManagerLayout
      restaurantName={identity.restaurantDisplayName}
      active={menu}
      onSelect={setMenu}
      notice={notices.current}
      headerRight={
        <button
          type="button"
          onClick={logout}
          aria-label="Keluar"
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ta-gray-300 bg-white px-3 text-sm font-semibold text-ta-gray-700 hover:bg-ta-gray-50"
        >
          <LogOut className="size-4" /> Keluar
        </button>
      }
    >
```
- Replace `OwnerNotice`→`TaNotice`, `OwnerEmpty`→`TaEmpty`, `OwnerRetry`→`TaRetry`, and wrap each menu's content in `<TaCard>` instead of the raw `<section className="rounded-2xl border border-slate-200 ...">`.
- Add a stat-card row above the tables grid (derived only from existing `tables` + `reminders`):
```tsx
        <div className="mb-4 grid grid-cols-3 gap-3">
          <TaStatCard label="Terisi" value={tables.filter((t) => t.status === "terisi").length} />
          <TaStatCard label="Kosong" value={tables.filter((t) => t.status === "kosong").length} />
          <TaStatCard label="Perlu Dicek" value={reminders.length} />
        </div>
```
- Keep the reminder banner, the `md:grid-cols-10` table grid, the crew desktop-table + mobile-tabs block, and the log list — only swap their wrapper classes to TailAdmin (`border-ta-gray-200`, `bg-white`, `shadow-theme-sm`, `text-ta-gray-*`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/index.tsx tests/manager-dashboard-route.test.ts
git commit -m "feat(theme): TailAdmin shell + stat cards on the manager dashboard (logic intact)"
```

---

## Task 6: Super Admin shell onto AppShell

**Files:**
- Modify: `src/routes/super-admin/route.tsx`
- Test: `tests/super-admin-route.test.ts` (update)

- [ ] **Step 1: Update the failing test**

In `tests/super-admin-route.test.ts`, add (keep existing auth assertions):
```ts
  it("renders the TailAdmin AppShell with a light sidebar", () => {
    const text = readFileSync(new URL("../src/routes/super-admin/route.tsx", import.meta.url), "utf8");
    expect(text).toContain("AppShell");
    expect(text).toContain("bg-brand-50");
    expect(text).not.toContain("bg-slate-950");
  });
```
(If the existing test file has no `readFileSync` import, add `import { readFileSync } from "node:fs";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/super-admin-route.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite the shell (keep auth logic)**

Edit `src/routes/super-admin/route.tsx`:
- Keep `loader: () => getAuthStatus()`, the `if (!auth?.superAdmin) return <AuthGate .../>` branch, `handleLogout`, `isOwnerQueryKey`, and the `nav` route list.
- Replace the hand-rolled `<aside>`/`<Sheet>`/mobile header markup with `<AppShell>`:
```tsx
import { AppShell, type AppShellNavItem } from "@/components/dashboard/AppShell";
```
Build `navItems` from the existing `nav` array (map `to`/`icon`/`active` via `useRouterState`/`pathname` or keep the `Link`-based active detection by passing `onSelect: () => navigate({to})` and `active: pathname === to`). Render:
```tsx
<AppShell
  brand={<span className="text-lg font-bold text-ta-gray-900">LIME</span>}
  navItems={navItems}
  headerTitle="Owner Console"
  headerRight={<button onClick={handleLogout} className={taSecondaryButtonClass}>Keluar</button>}
>
  <Outlet />
</AppShell>
```
- Import `taSecondaryButtonClass` from `@/components/dashboard/ui`. Remove the old `Sheet`/`Menu`/`Navigation` internals that are now replaced. Preserve the `Link`-based navigation semantics (use `useNavigate` in `onSelect`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/super-admin-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/super-admin/route.tsx tests/super-admin-route.test.ts
git commit -m "feat(theme): rebuild super-admin shell on the TailAdmin AppShell (light sidebar)"
```

---

## Task 7: Migrate super-admin pages to `dashboard/ui` (mechanical)

**Files (all MODIFY):** `src/routes/super-admin/index.tsx`, `restaurants/index.tsx`, `restaurants/$id.tsx`, `audio.tsx`, `history.tsx`, `error-log.tsx`, `esb-export.tsx`, `managers.tsx`
- Test: `tests/super-admin-shell.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/super-admin-shell.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = [
  "index","restaurants/index","restaurants/$id","audio","history",
  "error-log","esb-export","managers",
];
const read = (p: string) =>
  readFileSync(new URL(`../src/routes/super-admin/${p}.tsx`, import.meta.url), "utf8");

describe("super-admin pages migrated to TailAdmin", () => {
  for (const p of pages) {
    it(`${p}: no OwnerUi component imports, uses dashboard/ui`, () => {
      const s = read(p);
      expect(s).not.toMatch(/Owner(Page|Panel|Field|Notice|Empty|Loading|Retry|Pagination|PageHeader)/);
      expect(s).not.toContain("ownerPrimaryButtonClass");
      expect(s).not.toContain("ownerControlClass");
    });
  }
  it("dashboard index uses TaStatCard", () => {
    expect(read("index")).toContain("TaStatCard");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/super-admin-shell.test.ts`
Expected: FAIL (pages still import OwnerUi).

- [ ] **Step 3: Migrate each page (repeat per file)**

For EACH page in `pages`:
1. Change the import block `from "@/components/OwnerUi"` to `from "@/components/dashboard/ui"`, renaming every symbol via the mapping table (Task header). Keep `formatOwnerDate` imported from `@/components/OwnerUi` (pure util) — split it into its own import line if needed.
2. Rename all usages in JSX: `<OwnerPanel>`→`<TaCard>`, `<OwnerPage>`→`<TaPage>`, `<OwnerPageHeader>`→`<TaPageHeader>`, `<OwnerField>`→`<TaField>`, `<OwnerNotice>`→`<TaNotice>`, `<OwnerEmpty>`→`<TaEmpty>`, `<OwnerLoading>`→`<TaLoading>`, `<OwnerRetry>`→`<TaRetry>`, `<OwnerPagination>`→`<TaPagination>`, `<StatusBadge>`→`<TaBadge>`, `ownerControlClass`→`taControlClass`, `ownerPrimaryButtonClass`→`taPrimaryButtonClass`, `ownerSecondaryButtonClass`→`taSecondaryButtonClass`, `ownerDangerButtonClass`→`taDangerButtonClass`.
3. In `index.tsx` only: convert the existing `metrics.map` stat cards to `<TaStatCard label value icon tone>` (same data, same `Link` wrapper optional — keep the `Link` if present, just swap the inner card to `TaStatCard`), and change the amber accents (`text-amber-700`, `bg-amber-400`) to `text-brand-500` / `bg-brand-500`.
4. Do NOT change any query, mutation, handler, or data mapping.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/super-admin-shell.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/routes/super-admin tests/super-admin-shell.test.ts
git commit -m "feat(theme): migrate super-admin pages from OwnerUi to TailAdmin primitives"
```

---

## Task 8: Full quality gate + route tree

- [ ] **Step 1: Regenerate route tree + verify**

Run: `npm run verify`
Expected: exit 0 (test + typecheck + lint + build). Fix any class/type issues (prettier CRLF, unused imports from removed `Sheet`/`Menu` in route.tsx, etc.).

- [ ] **Step 2: Confirm crew untouched**

Run: `npx vitest run tests/crew-header-notice.test.ts tests/table-occupancy-realtime.test.ts`
Expected: PASS (crew + realtime still green — proves no crew regression).

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A
git commit -m "chore(theme): satisfy verify gate"
```

---

## Task 9: Manual visual pass (user)

- [ ] User reviews `/manager` and `/super-admin` on the branch preview (or local `npm run dev`), desktop + mobile.
- [ ] Collect tweaks for Phase 1.1; charts/dark-mode deferred to Phase 2.

---

## Self-Review Notes

- **Spec coverage:** tokens (T1), primitives (T2), AppShell (T3), Manager shell+stat cards (T4,T5), Super Admin shell (T6) + page migration (T7), gate + crew-safe check (T8). Phase 2 (charts/dark) explicitly deferred.
- **UI-only:** every task edits only imports/JSX/classes; T5/T6/T7 call out "keep logic byte-for-byte". T8 Step 2 guards crew regression.
- **Type consistency:** `AppShellNavItem` (T3) used by Manager (T4) + Super Admin (T6). `ManagerLayout` new props (`notice`,`headerRight`) match T5's caller. `Ta*` names match the mapping table used in T7.
- **Watch-outs:** `route.tsx` — remove now-unused `Sheet`/`Menu`/`X` imports (lint); keep `AuthGate` + `getAuthStatus` loader. `formatOwnerDate` stays in OwnerUi. `color-mix` badge/notice tones rely on Tailwind arbitrary values — verify build emits them (fallback to `bg-brand-50`/`text-ta-*` if a token is missing).
