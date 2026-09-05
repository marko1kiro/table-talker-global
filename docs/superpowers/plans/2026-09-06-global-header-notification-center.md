# SP1 — Global Header + Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seragamkan header ala Manager (RoleEmblem + ThemeToggle + NotificationCenter + ProfileMenu) dan jadikan bell pusat notifikasi (unread badge model FB + feed status meja + Perlu Dicek + placeholder), diterapkan ke Manager + Super Admin.

**Architecture:** Reducer murni `noticeCenterReducer` (unit-testable) dibungkus hook `useNotificationCenter`. Komponen presentational `NotificationCenter` + cluster `DashboardHeaderRight` dipakai rute. `ProfileMenu` di-extend (ID + ganti-password kondisional). `AppShell`/`ManagerLayout` kehilangan prop `notice` (banner pindah ke bell).

**Tech Stack:** React 19, TanStack Start/Router/Query, lucide-react, Tailwind (TailAdmin tokens + `dark:`), Vitest (source-assertion + unit murni, tanpa jsdom).

**Konvensi:** named imports only (`esModuleInterop:false`). Setelah edit file: `npx prettier --write <file>`. Gate: `npm run verify` exit 0 sebelum commit/push. Push ke branch `feat/global-header-notification-center` BUKAN main.

**Spec:** `docs/superpowers/specs/2026-09-06-global-header-notification-center-design.md`

---

## File Structure

- Create `src/hooks/use-notification-center.ts` — reducer murni + hook.
- Create `src/components/dashboard/NotificationCenter.tsx` — pusat notifikasi (ganti NotificationBell).
- Delete `src/components/dashboard/NotificationBell.tsx`.
- Create `src/components/dashboard/DashboardHeaderRight.tsx` — cluster header.
- Modify `src/components/dashboard/ProfileMenu.tsx` — `idManager?` + `canChangePassword?`.
- Modify `src/components/dashboard/AppShell.tsx` — buang prop `notice` + banner.
- Modify `src/components/ManagerLayout.tsx` — buang prop `notice` + pass-through.
- Modify `src/routes/manager/index.tsx` — wire hook + cluster, buang ToastSlot/useNoticeQueue.
- Modify `src/routes/super-admin/route.tsx` — cluster OWNER tanpa bell, buang tombol Keluar.
- Tests: create `tests/notice-center.test.ts`, `tests/notification-center.test.ts`, `tests/dashboard-header-right.test.ts`, `tests/super-admin-header.test.ts`; modify `tests/dashboard-header.test.ts`, `tests/app-shell.test.ts`, `tests/manager-dashboard-route.test.ts`.

---

## Task 1: `noticeCenterReducer` + `useNotificationCenter`

**Files:**
- Create: `src/hooks/use-notification-center.ts`
- Test: `tests/notice-center.test.ts`

- [ ] **Step 1: Tulis test gagal** — `tests/notice-center.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  noticeCenterReducer,
  initialNoticeCenterState,
  NOTICE_FEED_CAP,
} from "../src/hooks/use-notification-center";
import type { OccupancyNotice } from "../src/lib/occupancy-notice";

const n = (line1: string): OccupancyNotice => ({ line1, roleLabel: "KASIR", actorName: null });

describe("noticeCenterReducer", () => {
  it("push prepends newest and increments unread", () => {
    const s1 = noticeCenterReducer(initialNoticeCenterState, { type: "push", notice: n("A") });
    const s2 = noticeCenterReducer(s1, { type: "push", notice: n("B") });
    expect(s2.items.map((i) => i.line1)).toEqual(["B", "A"]);
    expect(s2.unread).toBe(2);
  });
  it("read zeroes unread but keeps items", () => {
    let s = noticeCenterReducer(initialNoticeCenterState, { type: "push", notice: n("A") });
    s = noticeCenterReducer(s, { type: "read" });
    expect(s.unread).toBe(0);
    expect(s.items).toHaveLength(1);
  });
  it("caps items at the cap but unread keeps counting (FB model)", () => {
    let s = initialNoticeCenterState;
    for (let i = 0; i < NOTICE_FEED_CAP + 10; i++)
      s = noticeCenterReducer(s, { type: "push", notice: n(`M${i}`) });
    expect(s.items).toHaveLength(NOTICE_FEED_CAP);
    expect(s.unread).toBe(NOTICE_FEED_CAP + 10);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/notice-center.test.ts`
Expected: FAIL — "Cannot find module '../src/hooks/use-notification-center'".

- [ ] **Step 3: Implement minimal** — `src/hooks/use-notification-center.ts`

```ts
import { useCallback, useReducer } from "react";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export const NOTICE_FEED_CAP = 100;

export type NoticeCenterState = { items: OccupancyNotice[]; unread: number };
export type NoticeCenterAction = { type: "push"; notice: OccupancyNotice } | { type: "read" };

export const initialNoticeCenterState: NoticeCenterState = { items: [], unread: 0 };

export function noticeCenterReducer(
  state: NoticeCenterState,
  action: NoticeCenterAction,
): NoticeCenterState {
  switch (action.type) {
    case "push":
      return {
        items: [action.notice, ...state.items].slice(0, NOTICE_FEED_CAP),
        unread: state.unread + 1,
      };
    case "read":
      return { ...state, unread: 0 };
  }
}

export function useNotificationCenter() {
  const [state, dispatch] = useReducer(noticeCenterReducer, initialNoticeCenterState);
  const push = useCallback(
    (notice: OccupancyNotice) => dispatch({ type: "push", notice }),
    [],
  );
  const markRead = useCallback(() => dispatch({ type: "read" }), []);
  return { items: state.items, unread: state.unread, push, markRead };
}
```

- [ ] **Step 4: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/hooks/use-notification-center.ts tests/notice-center.test.ts && npx vitest run tests/notice-center.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-notification-center.ts tests/notice-center.test.ts
git commit -m "feat(notif): noticeCenterReducer + useNotificationCenter (FB-style unread)"
```

---

## Task 2: `ProfileMenu` — ID + ganti-password kondisional

**Files:**
- Modify: `src/components/dashboard/ProfileMenu.tsx`
- Test: `tests/dashboard-header.test.ts`

- [ ] **Step 1: Tulis test gagal** — tambah `it` di `describe("ProfileMenu", ...)` (setelah test "shows the manager ID below the name"):

```ts
  it("makes the ID row and password item conditional", () => {
    const s = src("ProfileMenu.tsx");
    expect(s).toContain("idManager &&");
    expect(s).toContain("canChangePassword");
  });
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/dashboard-header.test.ts`
Expected: FAIL — assertion `idManager &&` / `canChangePassword` belum ada.

- [ ] **Step 3: Implement** — ganti signature + render di `ProfileMenu.tsx`

Signature (ganti baris `export function ProfileMenu({...})`):

```tsx
export function ProfileMenu({
  name,
  idManager,
  canChangePassword = true,
  onLogout,
}: {
  name: string;
  idManager?: string;
  canChangePassword?: boolean;
  onLogout: () => void;
}) {
```

Baris ID (ganti blok `<p ...>ID: {idManager}</p>` jadi kondisional):

```tsx
            {idManager && (
              <p className="truncate text-xs text-ta-gray-500 dark:text-ta-gray-400">
                ID: {idManager}
              </p>
            )}
```

Item "Ganti password" (bungkus `<button ... disabled ...>...</button>` yang ada dengan `{canChangePassword && ( ... )}`).

- [ ] **Step 4: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/components/dashboard/ProfileMenu.tsx tests/dashboard-header.test.ts && npx vitest run tests/dashboard-header.test.ts`
Expected: PASS (semua test ProfileMenu + dashboard-header).

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/ProfileMenu.tsx tests/dashboard-header.test.ts
git commit -m "feat(profile): optional idManager + canChangePassword"
```

---

## Task 3: `NotificationCenter` (ganti `NotificationBell`)

**Files:**
- Create: `src/components/dashboard/NotificationCenter.tsx`
- Delete: `src/components/dashboard/NotificationBell.tsx`
- Test: `tests/notification-center.test.ts`

- [ ] **Step 1: Tulis test gagal** — `tests/notification-center.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(
    new URL("../src/components/dashboard/NotificationCenter.tsx", import.meta.url),
    "utf8",
  );

describe("NotificationCenter", () => {
  it("is a unified center: stale + activity feed + unread badge + placeholder", () => {
    const s = src();
    expect(s).toContain("Perlu Dicek");
    expect(s).toContain("Aktivitas");
    expect(s).toContain("Belum ada perubahan status meja");
    expect(s).toContain("unread");
    expect(s).toContain("onOpen");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/notification-center.test.ts`
Expected: FAIL — module belum ada.

- [ ] **Step 3: Implement** — `src/components/dashboard/NotificationCenter.tsx`

```tsx
import { useEffect, useRef, useState } from "react";
import { Bell, Clock } from "lucide-react";
import type { StaleNotice } from "@/lib/manager-reminder";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export function NotificationCenter({
  stale,
  feed,
  unread,
  onOpen,
}: {
  stale: StaleNotice[];
  feed: OccupancyNotice[];
  unread: number;
  onOpen: () => void;
}) {
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
  const toggle = () =>
    setOpen((o) => {
      const next = !o;
      if (next) onOpen();
      return next;
    });
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Notifikasi"
        aria-expanded={open}
        onClick={toggle}
        className="relative grid size-10 place-items-center rounded-lg border border-ta-gray-200 bg-white text-ta-gray-600 transition hover:bg-ta-gray-100 dark:border-ta-gray-700 dark:bg-ta-gray-800 dark:text-ta-gray-300 dark:hover:bg-ta-gray-700"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-ta-error px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-ta-gray-200 bg-white shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800">
          {stale.length > 0 && (
            <div className="border-b border-ta-gray-100 dark:border-ta-gray-700">
              <p className="px-4 py-2 text-[11px] font-bold text-ta-gray-500 uppercase dark:text-ta-gray-400">
                Perlu Dicek
              </p>
              <ul className="max-h-48 divide-y divide-ta-gray-100 overflow-y-auto dark:divide-ta-gray-700">
                {stale.map((it) => (
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
            </div>
          )}
          <p className="px-4 py-2 text-[11px] font-bold text-ta-gray-500 uppercase dark:text-ta-gray-400">
            Aktivitas
          </p>
          {feed.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ta-gray-400">
              Belum ada perubahan status meja
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-ta-gray-100 overflow-y-auto dark:divide-ta-gray-700">
              {feed.map((item, i) => (
                <li
                  key={`${item.line1}-${i}`}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-ta-gray-800 dark:text-ta-gray-100">
                    {item.line1}
                  </span>
                  <span className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    {item.roleLabel}
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

- [ ] **Step 4: Hapus `NotificationBell.tsx`**

Run: `git rm src/components/dashboard/NotificationBell.tsx`
(Manager masih mengimpornya sampai Task 6 — build akan gagal sementara; itu OK karena gate penuh di Task 8. Kalau mau tiap commit hijau, tunda penghapusan file ke Task 6. Keputusan: **hapus di Task 6** bersamaan dengan pemindahan impor. Untuk Task 3 ini, JANGAN hapus dulu — cukup buat `NotificationCenter.tsx`.)

- [ ] **Step 5: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/components/dashboard/NotificationCenter.tsx tests/notification-center.test.ts && npx vitest run tests/notification-center.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/NotificationCenter.tsx tests/notification-center.test.ts
git commit -m "feat(notif): NotificationCenter (stale + activity feed + unread badge + placeholder)"
```

---

## Task 4: `DashboardHeaderRight` cluster

**Files:**
- Create: `src/components/dashboard/DashboardHeaderRight.tsx`
- Test: `tests/dashboard-header-right.test.ts`

- [ ] **Step 1: Tulis test gagal** — `tests/dashboard-header-right.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(
    new URL("../src/components/dashboard/DashboardHeaderRight.tsx", import.meta.url),
    "utf8",
  );

describe("DashboardHeaderRight", () => {
  it("renders the cluster with a conditional bell", () => {
    const s = src();
    expect(s).toContain("RoleEmblem");
    expect(s).toContain("ThemeToggle");
    expect(s).toContain("ProfileMenu");
    expect(s).toContain("NotificationCenter");
    expect(s).toContain("notifications &&");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/dashboard-header-right.test.ts`
Expected: FAIL — module belum ada.

- [ ] **Step 3: Implement** — `src/components/dashboard/DashboardHeaderRight.tsx`

```tsx
import { RoleEmblem } from "./RoleEmblem";
import { ThemeToggle } from "./ThemeToggle";
import { ProfileMenu } from "./ProfileMenu";
import { NotificationCenter } from "./NotificationCenter";
import type { StaleNotice } from "@/lib/manager-reminder";
import type { OccupancyNotice } from "@/lib/occupancy-notice";

export function DashboardHeaderRight({
  roleLabel,
  profile,
  notifications,
  onLogout,
}: {
  roleLabel: string;
  profile: { name: string; idManager?: string; canChangePassword?: boolean };
  notifications?: {
    stale: StaleNotice[];
    feed: OccupancyNotice[];
    unread: number;
    onOpen: () => void;
  };
  onLogout: () => void;
}) {
  return (
    <>
      <RoleEmblem label={roleLabel} />
      <ThemeToggle />
      {notifications && (
        <NotificationCenter
          stale={notifications.stale}
          feed={notifications.feed}
          unread={notifications.unread}
          onOpen={notifications.onOpen}
        />
      )}
      <ProfileMenu
        name={profile.name}
        idManager={profile.idManager}
        canChangePassword={profile.canChangePassword}
        onLogout={onLogout}
      />
    </>
  );
}
```

- [ ] **Step 4: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/components/dashboard/DashboardHeaderRight.tsx tests/dashboard-header-right.test.ts && npx vitest run tests/dashboard-header-right.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/DashboardHeaderRight.tsx tests/dashboard-header-right.test.ts
git commit -m "feat(header): DashboardHeaderRight cluster (emblem+toggle+conditional bell+profile)"
```

---

## Task 5: `AppShell` + `ManagerLayout` — buang prop `notice`

**Files:**
- Modify: `src/components/dashboard/AppShell.tsx`
- Modify: `src/components/ManagerLayout.tsx`
- Test: `tests/app-shell.test.ts`

- [ ] **Step 1: Tulis test gagal** — di `tests/app-shell.test.ts`, ganti test "has a sticky header and a notice banner slot" menjadi:

```ts
  it("has a sticky header and no standalone notice banner (moved to bell)", () => {
    const s = src();
    expect(s).toContain("sticky top-0");
    expect(s).not.toContain("notice");
  });
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/app-shell.test.ts`
Expected: FAIL — `notice` masih ada di AppShell.

- [ ] **Step 3: Implement AppShell** — hapus dari `AppShell.tsx`:
  - impor `import type { OccupancyNotice } from "@/lib/occupancy-notice";`
  - param `notice,` di destructuring + `notice?: OccupancyNotice | null;` di tipe props
  - seluruh blok `{notice && ( ... )}` (banner mobile `md:hidden`).

- [ ] **Step 4: Implement ManagerLayout** — hapus dari `ManagerLayout.tsx`:
  - impor `import type { OccupancyNotice } from "@/lib/occupancy-notice";`
  - param `notice,` + `notice?: OccupancyNotice | null;` di tipe props
  - prop `notice={notice}` yang diteruskan ke `<AppShell ... />`.

- [ ] **Step 5: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/components/dashboard/AppShell.tsx src/components/ManagerLayout.tsx tests/app-shell.test.ts && npx vitest run tests/app-shell.test.ts`
Expected: PASS. (Manager route masih mengirim `notice=` ke ManagerLayout → error TS sementara; dibereskan Task 6. Typecheck penuh di Task 8.)

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/AppShell.tsx src/components/ManagerLayout.tsx tests/app-shell.test.ts
git commit -m "refactor(shell): drop notice prop (banner moves into NotificationCenter)"
```

---

## Task 6: Wire Manager route

**Files:**
- Modify: `src/routes/manager/index.tsx`
- Delete: `src/components/dashboard/NotificationBell.tsx`
- Test: `tests/manager-dashboard-route.test.ts`

- [ ] **Step 1: Update test (MERAH)** — di `tests/manager-dashboard-route.test.ts`:
  - Test "keeps core logic intact": hapus `expect(text()).toContain("formatOccupancyNotice");` bila tidak lagi dipakai? **Tetap dipakai** (callback) → biarkan.
  - Test "uses the TailAdmin shell + primitives + stat cards": ganti `expect(text()).toContain("ToastSlot");` → `expect(text()).not.toContain("ToastSlot");`
  - Test "renders the header cluster ...": ganti seluruh isinya menjadi:

```ts
  it("renders the unified header cluster via DashboardHeaderRight", () => {
    expect(text()).toContain("DashboardHeaderRight");
    expect(text()).toContain('roleLabel="MANAGER"');
    expect(text()).toContain("useNotificationCenter");
    expect(text()).toContain("idManager={identity.idManager}");
  });
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/manager-dashboard-route.test.ts`
Expected: FAIL (ToastSlot masih ada, DashboardHeaderRight belum).

- [ ] **Step 3: Implement — impor** di `src/routes/manager/index.tsx`:
  - Ganti 4 impor (`RoleEmblem`, `ThemeToggle`, `NotificationBell`, `ProfileMenu`) jadi satu:
    `import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";`
  - Tambah: `import { useNotificationCenter } from "@/hooks/use-notification-center";`
  - Hapus: `import { useNoticeQueue } from "@/hooks/use-notice-queue";`
  - Baris `import { formatOccupancyNotice, type OccupancyNotice } from "@/lib/occupancy-notice";` → jadi `import { formatOccupancyNotice } from "@/lib/occupancy-notice";` (OccupancyNotice tak lagi direferensi setelah ToastSlot dihapus).

- [ ] **Step 4: Implement — state & callback**:
  - Hapus fungsi `ToastSlot` (blok `function ToastSlot(...) {...}`).
  - Ganti `const [log, setLog] = useState<OccupancyNotice[]>([]);` dan `const notices = useNoticeQueue();` menjadi:
    `const { items, unread, push, markRead } = useNotificationCenter();`
  - Callback realtime: ganti
    ```
    const notice = formatOccupancyNotice(broadcast);
    if (notice) {
      notices.push(notice);
      setLog((prev) => [notice, ...prev].slice(0, 100));
    }
    ```
    menjadi:
    ```
    const notice = formatOccupancyNotice(broadcast);
    if (notice) push(notice);
    ```

- [ ] **Step 5: Implement — render**:
  - `headerRight={ ... }` (blok RoleEmblem/ThemeToggle/NotificationBell/ProfileMenu) diganti:
    ```tsx
    headerRight={
      <DashboardHeaderRight
        roleLabel="MANAGER"
        profile={{ name: identity.fullName, idManager: identity.idManager }}
        notifications={{ stale: staleNotices, feed: items, unread, onOpen: markRead }}
        onLogout={logout}
      />
    }
    ```
  - Hapus prop `notice={notices.current}` dari `<ManagerLayout ... />`.
  - Hapus kedua pemakaian `<ToastSlot notice={notices.current} />` (blok `menu === "tables"` dan `menu === "log"`).
  - Menu `log`: ganti `log.length` → `items.length` dan `log.map((n, i) => ...)` → `items.map((n, i) => ...)`.

- [ ] **Step 6: Hapus `NotificationBell.tsx`**

Run: `git rm src/components/dashboard/NotificationBell.tsx`

- [ ] **Step 7: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/routes/manager/index.tsx tests/manager-dashboard-route.test.ts && npx vitest run tests/manager-dashboard-route.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/manager/index.tsx tests/manager-dashboard-route.test.ts src/components/dashboard/NotificationBell.tsx
git commit -m "feat(manager): unified header cluster + notification center; drop ToastSlot/banner"
```

---

## Task 7: Wire Super Admin route

**Files:**
- Modify: `src/routes/super-admin/route.tsx`
- Test: `tests/super-admin-header.test.ts`

- [ ] **Step 1: Tulis test gagal** — `tests/super-admin-header.test.ts`

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/routes/super-admin/route.tsx", import.meta.url), "utf8");

describe("super-admin header", () => {
  it("uses the unified cluster as OWNER with no notification bell", () => {
    const s = src();
    expect(s).toContain("DashboardHeaderRight");
    expect(s).toContain('roleLabel="OWNER"');
    expect(s).toContain("canChangePassword: false");
    expect(s).not.toContain("NotificationCenter");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/super-admin-header.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — `src/routes/super-admin/route.tsx`:
  - Tambah impor `import { DashboardHeaderRight } from "@/components/dashboard/DashboardHeaderRight";`
  - Hapus impor `ThemeToggle` (tak dipakai lagi) dan `taSecondaryButtonClass` bila hanya dipakai tombol Keluar (cek: kalau masih dipakai di tempat lain, biarkan).
  - Ganti `headerRight={ <> <ThemeToggle /> <button ...Keluar...</button> </> }` menjadi:
    ```tsx
    headerRight={
      <DashboardHeaderRight
        roleLabel="OWNER"
        profile={{ name: "Owner", canChangePassword: false }}
        onLogout={handleLogout}
      />
    }
    ```
  - `loggingOut`/`"Keluar..."` tak lagi dirender di tombol (logout ada di dropdown). Biarkan state `loggingOut` bila masih dipakai untuk disable; kalau tak terpakai sama sekali, hapus untuk hindari lint unused. `logoutError` banner tetap.

- [ ] **Step 4: Format + jalankan, pastikan LULUS**

Run: `npx prettier --write src/routes/super-admin/route.tsx tests/super-admin-header.test.ts && npx vitest run tests/super-admin-header.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/super-admin/route.tsx tests/super-admin-header.test.ts
git commit -m "feat(super-admin): unified OWNER header (no bell), logout via profile menu"
```

---

## Task 8: Full quality gate

- [ ] **Step 1: `npm run verify`**

Run: `npm run verify`
Expected: exit 0 (test + typecheck + lint + build). Perbaiki apa pun yang muncul (impor tak terpakai, `loggingOut` unused, dsb.), lalu ulangi.

- [ ] **Step 2: Commit perbaikan gate (bila ada)**

```bash
git add -A
git commit -m "chore: satisfy quality gate for global header SP1"
```

- [ ] **Step 3: Push ke branch (BUKAN main)**

```bash
git push -u origin feat/global-header-notification-center
```

---

## Self-Review (penulis plan)

- **Cakupan spec:** reducer/hook (T1), ProfileMenu kondisional (T2), NotificationCenter (T3), cluster (T4), buang notice banner (T5), Manager wire + hapus NotificationBell (T6), Super Admin wire (T7), gate+push (T8). Semua butir spec ada task-nya.
- **Placeholder:** tidak ada TBD; tiap step kode/command lengkap.
- **Konsistensi tipe:** `noticeCenterReducer`/`useNotificationCenter`/`NOTICE_FEED_CAP` (T1) dipakai T6; `NotificationCenter` props `{stale,feed,unread,onOpen}` (T3) = pemakaian T4; `DashboardHeaderRight` props (T4) = pemakaian T6/T7; `StaleNotice`/`OccupancyNotice` sesuai `manager-reminder.ts`/`occupancy-notice.ts`.
- **Catatan urutan:** `NotificationBell.tsx` sengaja dihapus di T6 (bukan T3) supaya tiap commit tetap build-hijau; `notice` prop dibuang T5 tapi pemakai Manager dibersihkan T6 — typecheck penuh baru dijaga di T8 (gate). Ini trade-off yang disengaja; semua terselesaikan sebelum push.
