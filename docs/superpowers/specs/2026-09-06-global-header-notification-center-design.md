# SP1 — Global Header + Notification Center (Design Spec)

**Tanggal:** 2026-09-06
**Cabang:** `feat/global-header-notification-center`
**Status:** Disetujui user (design dialogue), siap ke plan.

## Latar & Goal

User suka header Dashboard Manager (AppShell: `RoleEmblem` + `ThemeToggle` +
`NotificationBell` + `ProfileMenu`) dan ingin menjadikannya **header global** untuk
semua dashboard. Kesepakatan hasil brainstorming:

- **Scope = Approach B**: semua dashboard pakai **bar header** ala Manager, tapi
  Kasir/Satgas/Clear Up/SS tetap **body full-screen** (tanpa sidebar). Hanya bar
  atas yang diseragamkan.
- **Badge role** (`RoleEmblem`) = **nama role masing-masing**. Self Service = **"SS"**.
- **Banner/placeholder "status meja" dipindah ke dalam ikon Notifikasi.** Bell jadi
  **pusat notifikasi** (Approach A): feed perubahan status live + alert "Perlu Dicek"
  + placeholder kosong, semuanya di dalam dropdown bell.
- **Bell = model Facebook**: badge angka = jumlah item **Aktivitas baru** sejak bell
  terakhir dibuka; bertambah tiap sinyal realtime; **ke-reset 0 saat bell diklik**;
  history tetap ada di list. Sumber = log in-memory (cap 100, hilang saat refresh),
  sama seperti "LOG AKTIVITAS CREW" Manager.
- **Dark mode untuk semua (Approach A)** — termasuk crew/SS.

## Dekomposisi (Approach 1 — per dashboard)

Pekerjaan dipecah jadi 3 sub-project berurutan, masing-masing spec → plan → siklus
TDD → `npm run verify` → push sendiri, supaya toggle dark tidak pernah ship dalam
keadaan setengah jadi:

- **SP1 (spec ini)** — Bangun chrome global (header cluster + notification center +
  RoleEmblem per-role + ProfileMenu per-role) dan terapkan ke **Manager + Super
  Admin** (dua-duanya sudah dark-ready, jadi toggle langsung benar).
- **SP2 (follow-up)** — Kasir + Satgas + Clear Up: adopsi header global + **restyle
  dark penuh body** (grid/list/dialog/legend).
- **SP3 (follow-up)** — Self Service (`/`): **buang total neo-brutalism**, rebuild ke
  TailAdmin + header global + dark.

SP1 hanya menyentuh Manager + Super Admin. Crew/SS belum disentuh di sini.

## Arsitektur Komponen

Semua komponen chrome di `src/components/dashboard/`.

### 1. `useNotificationCenter()` — hook + reducer murni (baru)

File: `src/hooks/use-notification-center.ts` + reducer murni diekspor terpisah supaya
unit-testable tanpa React.

```
type NoticeCenterState = { items: OccupancyNotice[]; unread: number };
type NoticeCenterAction =
  | { type: "push"; notice: OccupancyNotice }
  | { type: "read" };

noticeCenterReducer(state, action):
  push -> { items: [notice, ...state.items].slice(0, 100), unread: state.unread + 1 }
  read -> { ...state, unread: 0 }
```

- Cap 100 (sama seperti log lama). `unread` naik tiap `push` **tanpa peduli cap**,
  jadi counter tidak "mentok" saat list penuh (menghindari bug model index-based).
- `useNotificationCenter()` = `useReducer(noticeCenterReducer, { items: [], unread: 0 })`
  + helper `push(notice)` / `markRead()` (stabil via dispatch).
- In-memory saja → hilang saat refresh (sesuai permintaan).

### 2. `NotificationCenter` (ganti `NotificationBell`)

File: `src/components/dashboard/NotificationCenter.tsx`. `NotificationBell.tsx` dihapus.

Props: `{ stale: StaleNotice[]; feed: OccupancyNotice[]; unread: number; onOpen: () => void }`.

- Tombol lonceng (`Bell`) + **badge** = `unread` (render hanya bila `unread > 0`).
- Klik lonceng → toggle dropdown **dan** panggil `onOpen()` (= `markRead`).
- Perilaku buka/tutup dropdown + klik-luar + Escape dipertahankan seperti bell lama.
- Isi dropdown, atas → bawah:
  1. Seksi **"Perlu Dicek"** — dari `stale` (`Meja {table} perlu dicek`, `>{duration}`).
     Bila `stale` kosong, seksi ini tidak dirender.
  2. Seksi **"Aktivitas"** — dari `feed` (`line1` + pill `roleLabel` + `actorName`).
     Terbaru di atas. Bila `feed` kosong → placeholder **"Belum ada perubahan status
     meja"**.
- Styling TailAdmin + varian `dark:` (konsisten dengan primitif `dashboard/ui.tsx`).

### 3. `ProfileMenu` (extend, backward-compatible)

- `idManager?: string` → baris **"ID: {idManager}"** dirender hanya bila terisi.
- `canChangePassword?: boolean` (default `true`) → item "Ganti password" disembunyikan
  bila `false` (untuk Owner).
- `name` tetap wajib.

### 4. `DashboardHeaderRight` (cluster, baru)

File: `src/components/dashboard/DashboardHeaderRight.tsx`. Ini pola yang dipakai semua
dashboard (SP2/SP3 ikut).

Props:
```
{
  roleLabel: string;
  profile: { name: string; idManager?: string; canChangePassword?: boolean };
  notifications?: { stale: StaleNotice[]; feed: OccupancyNotice[]; unread: number; onOpen: () => void };
  onLogout: () => void;
}
```
Render: `RoleEmblem label={roleLabel}` + `ThemeToggle` + (`NotificationCenter` **hanya
bila** `notifications` diisi) + `ProfileMenu`.

## Perubahan Per-Rute (SP1)

### Manager (`src/routes/manager/index.tsx`)
- Ganti state `log` + `useNoticeQueue` dengan `useNotificationCenter()`.
- Callback realtime: `push(notice)` (bukan `notices.push` + `setLog`).
- `headerRight` = `<DashboardHeaderRight roleLabel="MANAGER" profile={{ name: identity.fullName, idManager: identity.idManager }} notifications={{ stale: staleNotices, feed: items, unread, onOpen: markRead }} onLogout={logout} />`.
- Menu **"LOG AKTIVITAS CREW"** membaca `items` (satu sumber kebenaran dengan bell).
- **Hapus `ToastSlot`** (definisi + pemakaian) dan **hapus prop `notice`** ke AppShell.
- `staleNotices` (buildStaleNotices) tetap; sekarang masuk bell, bukan kartu terpisah
  (kartu statistik "Perlu Dicek" di grid tetap ada — itu ringkasan, bukan banner).

### Super Admin (`src/routes/super-admin/route.tsx`)
- `headerRight` = `<DashboardHeaderRight roleLabel="OWNER" profile={{ name: "Owner", canChangePassword: false }} onLogout={handleLogout} />`.
- **Tanpa `notifications`** → bell tidak muncul (owner console tidak terikat 1 resto).
- Buang tombol "Keluar" polos (`taSecondaryButtonClass`) — logout pindah ke ProfileMenu.
- `headerTitle` "Owner Console" tetap.

### AppShell (`src/components/dashboard/AppShell.tsx`)
- **Hapus prop `notice` + blok banner mobile** (dead code setelah Manager pindah ke bell).
- `headerLogo` (mobile logo) tetap — Super Admin belum memakainya (opsional).

## Alur Data (Manager)

```
useTableOccupancyRealtime broadcast
  -> formatOccupancyNotice(broadcast) -> notice
  -> push(notice)  [useNotificationCenter]
       items (cap 100, terbaru di atas)  -> bell "Aktivitas" + menu LOG
       unread++                            -> badge bell
  buka bell -> onOpen() -> markRead() -> unread = 0 (items tetap)
snapshot realtime -> buildStaleNotices -> stale -> bell "Perlu Dicek" (live, bukan unread)
```

## Penanganan Error / Edge

- `formatOccupancyNotice` mengembalikan `null` untuk broadcast tak valid → tidak di-push
  (sama seperti sekarang).
- Cap 100: item lama terbuang dari list, tapi `unread` tidak pernah "kurang" — tetap
  akurat sebagai penghitung event sejak dibuka.
- Feed kosong → placeholder; stale kosong → seksi Perlu Dicek hilang; keduanya kosong →
  dropdown hanya menampilkan placeholder Aktivitas.
- Owner tidak punya feed realtime → bell dihilangkan total (bukan bell kosong).

## Testing (konvensi repo: source-assertion + unit murni, tanpa jsdom)

- **Unit murni** `tests/notice-center.test.ts` — impor `noticeCenterReducer`:
  - `push` → `unread+1`, item terbaru di depan, `items` ≤ 100.
  - `read` → `unread=0`, `items` utuh.
  - push setelah cap 100 → panjang tetap 100, `unread` terus naik.
- **Source-assertion**:
  - `NotificationCenter.tsx`: ada `"Perlu Dicek"`, `"Aktivitas"`,
    `"Belum ada perubahan status meja"`, badge `unread`, `onOpen`.
  - `DashboardHeaderRight.tsx`: `RoleEmblem`, `ThemeToggle`, `ProfileMenu`, bell
    kondisional (`notifications &&`).
  - `manager/index.tsx`: `useNotificationCenter`, `DashboardHeaderRight`,
    `roleLabel="MANAGER"`, `not.toContain("ToastSlot")`.
  - `super-admin/route.tsx`: `DashboardHeaderRight`, `roleLabel="OWNER"`,
    `not.toContain("NotificationCenter")` (via tidak ada `notifications`).
  - `ProfileMenu.tsx`: `idManager?` kondisional, `canChangePassword`.
  - `app-shell.test.ts`: buang assertion `notice`.
- Gate: `npm run verify` exit 0 (test + typecheck + lint + build) sebelum commit/push.

## Di Luar Scope SP1

- Restyle dark body crew (SP2) dan de-brutalism SS (SP3).
- Migrasi `useNoticeQueue` crew ke notification center (SP2).
- Ganti password manager (masih "Segera hadir" / disabled).

## Catatan Keamanan / Persistensi

- Tidak ada perubahan DB/migration/RPC. Tidak ada kredensial baru.
- `unread`/`items` murni state klien in-memory; tidak dipersistensi (sesuai request).
