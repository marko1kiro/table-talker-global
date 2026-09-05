# SP2 — Crew Global Header + Full Dark Restyle (Design Spec)

**Tanggal:** 2026-09-06
**Cabang:** `feat/global-header-notification-center` (lanjutan SP1)
**Dependensi:** SP1 (`DashboardHeaderRight`, `NotificationCenter`, `useNotificationCenter`, `ProfileMenu` kondisional, `ThemeToggle`, `RoleEmblem`).

## Goal

Kasir + Satgas + Clear Up mengadopsi **header global** ala Manager dan **dark mode penuh** di semua permukaan. Mobile-first, tanpa sidebar/desktop.

## Keputusan (disetujui user)

- **Header crew = mobile-first, selalu.** Tanpa title, tanpa sidebar/desktop. Urutan: **Logo** (kiri) | **RoleEmblem → ThemeToggle → NotificationCenter → ProfileMenu** (kanan) — identik header mobile Manager.
- **Bell crew = feed "Aktivitas" saja** (`stale=[]`). "Perlu Dicek" khusus Manager.
- **Dark = varian `dark:` eksplisit**; tampilan light tidak berubah.
- Label `RoleEmblem`: **KASIR / SATGAS / CLEAR UP**. `ProfileMenu`: `name=displayName`, tanpa `idManager`, `canChangePassword:false`.

## Arsitektur

### 1. `ThemeFrame` (ekstraksi dari AppShell)

File baru `src/components/dashboard/ThemeFrame.tsx`. Pindahkan dari `AppShell`:
`useTheme()` + `<ThemeContext.Provider>` + `<div className={cn("min-h-[100svh] bg-ta-gray-50 font-outfit text-ta-gray-900 dark:bg-ta-gray-900 dark:text-ta-gray-100", isDark && "dark")}>`.

```
ThemeFrame({ children }: { children: ReactNode })
```
`AppShell` jadi pakai `<ThemeFrame>` (buang duplikasi provider/dark-class). `CrewShell` juga pakai `ThemeFrame`.

### 2. `CrewShell` (baru)

File `src/components/dashboard/CrewShell.tsx`. Menggantikan `CrewHeader` untuk header.

```
CrewShell({
  roleLabel, userName, onLogout, feed, unread, onOpen, children,
}: {
  roleLabel: string; userName: string; onLogout: () => void;
  feed: OccupancyNotice[]; unread: number; onOpen: () => void;
  children: ReactNode;
})
```
Render:
```
<ThemeFrame>
  <header sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-ta-gray-200 bg-white/95 px-4 py-2.5 backdrop-blur dark:border-ta-gray-700 dark:bg-ta-gray-800/95>
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
```
Mobile-first: tanpa breakpoint sidebar; `max-w-[720px]` biar gak melebar ekstrem di tablet/desktop.

### 3. Wiring tiap rute crew (kasir/satgas/clear-up)

- Ganti `const notices = useNoticeQueue();` → `const { items, unread, push, markRead } = useNotificationCenter();`.
- Callback realtime: `if (notice) notices.push(notice);` → `if (notice) push(notice);`.
- Ganti `<CrewHeader ... notice={notices.current} />` → bungkus konten rute dengan `<CrewShell roleLabel="KASIR" userName={identity.displayName} onLogout={logout} feed={items} unread={unread} onOpen={markRead}> ... </CrewShell>`.
- Buang impor `CrewHeader` + `useNoticeQueue`; buang pembungkus `<div className="mx-auto w-full max-w-[1440px] ...">` (kasir) karena `CrewShell` sudah menyediakan kontainer.
- `OwnerPage`/`OwnerNotice`/`OwnerPanel`/`OwnerRetry`/`OwnerEmpty`/`CrewTableSection`/`AlertDialog` tetap dipakai (di-restyle dark).

### 4. `CrewHeader.tsx` — hapus komponen `CrewHeader`

File tetap ada untuk `CrewTableSection` + `crewPrimaryButtonClass` + `crewSecondaryButtonClass` (di-restyle dark). Komponen `CrewHeader` + `LEGEND_DOT_CLASS`? `LEGEND_DOT_CLASS` dipakai `CrewTableSection` → tetap. `formatRestaurantLabel` impor jadi tak terpakai → buang.

## Restyle Dark (varian `dark:`; light utuh)

### `OwnerUi.tsx`
- `ownerControlClass`, `ownerPrimaryButtonClass`, `ownerSecondaryButtonClass`, `ownerDangerButtonClass`: tambah `dark:` (bg/border/text/ring).
- `OwnerPanel` (`bg-white border-slate-200`), `OwnerPageHeader` (teks), `OwnerField`, `StatusBadge` (tiap tone), `OwnerNotice` (tiap tone), `OwnerLoading`, `OwnerEmpty`, `OwnerPagination`: tambah `dark:`.

### `CrewHeader.tsx` (`CrewTableSection` + button classes)
- `CrewTableSection` section card (`bg-white border-slate-200`), header border, judul, legend text, toggle button → `dark:`.
- `crewPrimaryButtonClass` / `crewSecondaryButtonClass` → `dark:`.

### `components/ui/alert-dialog.tsx`
- `AlertDialogContent` (`bg-background` sudah ikut `.dark`), tapi `border`/overlay/`AlertDialogOverlay` + teks → tambah `dark:`/varian yang benar (overlay `bg-black/50` sudah oke; pastikan `border` & `text-foreground` kebaca). Minimal: `AlertDialogContent` border `dark:border-ta-gray-700`, `AlertDialogTitle`/`Description` warna teks dark.

### Per-rute grid/list
- **kasir** `TableGrid`/`TableList`: state kosong (emerald) & terisi (red) → `dark:` tint.
- **clear-up** `TableGrid`/`TableList`: red queue → `dark:`.
- **satgas** `TableGrid`/`TableList`: emerald/amber/red → `dark:`; panel "Menunggu Konfirmasi" (`bg-amber-50 border-amber-300 text-amber-800`) → `dark:`; dialog escort/cancel ikut (via alert-dialog + button classes).

## Testing (source-assertion; tanpa jsdom)

- `theme-frame.test.ts`: `ThemeFrame.tsx` ada `ThemeContext.Provider` + `isDark && "dark"`.
- `app-shell.test.ts`: AppShell pakai `ThemeFrame` (`toContain("ThemeFrame")`), tetap punya dark class behavior via frame.
- `crew-shell.test.ts`: `CrewShell.tsx` ada `lime-logo.webp`, `DashboardHeaderRight`, `stale: []`, `ThemeFrame`, tanpa `md:` sidebar.
- `crew-routes.test.ts` (atau perluas test rute crew yang ada): tiap rute `toContain("CrewShell")`, `useNotificationCenter`, `not.toContain("CrewHeader")`, `not.toContain("useNoticeQueue")`.
- `owner-ui-dark.test.ts`: `OwnerUi.tsx` `toContain("dark:")` (beberapa), `crew-header.test.ts`: `CrewTableSection` `toContain("dark:")`.
- `alert-dialog-dark.test.ts`: `alert-dialog.tsx` `toContain("dark:")`.
- Gate: `npm run verify` exit 0.

## Edge / Risiko

- `useNoticeQueue` tetap dipakai SS (`/`) sampai SP3 → jangan hapus file hook-nya.
- `CrewHeader` dipakai 3 rute → semua dimigrasikan di SP2 (tidak ada konsumen tersisa). `LEGEND_DOT_CLASS` + `CrewTableSection` + button classes dipertahankan.
- Warna dark crew: pakai tint `ta-*`/`-{color}-900/400` yang konsisten; jaga kontras AA.
- Tidak ada perubahan DB/RPC/logika transisi status.

## Di Luar Scope SP2

- SS de-brutalism (SP3).
- Perlu Dicek di bell crew (sengaja off).
