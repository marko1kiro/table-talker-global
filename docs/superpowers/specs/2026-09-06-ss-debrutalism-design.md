# SP3 — Self Service (SS) & Public Pages: De-brutalism → TailAdmin + Dark (Design Spec)

**Tanggal:** 2026-09-06
**Cabang:** `feat/global-header-notification-center` (lanjutan SP1/SP2)
**Dependensi:** SP1/SP2 (`DashboardHeaderRight`, `RoleEmblem`, `ThemeToggle`, `ProfileMenu`, `ThemeFrame`, TailAdmin tokens + `dark:`).

## Goal

Buang **total** neo-brutalism dari aplikasi: stasiun Self Service (`/`) + `Header` + `Footer` + `TableButton` + `SoundboardGrid` + `SyncDialog` + `RestaurantCredentialDialog` + 6 halaman info publik (about/contact/faq/help/privacy/terms) + 404/error boundary — semua di-restyle ke **TailAdmin** (bahasa visual sama kayak Manager) + **dark mode penuh**.

## Keputusan (disetujui user)

- **Q1 = B**: semua brutalism hilang sekaligus (stasiun + halaman publik + 404 + Footer).
- **Q2 = A**: stasiun SS = **full-screen TailAdmin, mobile-first, TANPA sidebar**. Header = logo + RoleEmblem "SS" + ThemeToggle + Profile (logout). **Tanpa bell** (SS gak punya feed realtime).
- **Q3 (default)**: `readyCount` + tombol help **tetap di header**, di-TailAdmin-kan; "Stop" announcement + grid → TailAdmin + dark.

## Prinsip Restyle

Ganti bahasa visual brutal → TailAdmin. Mapping (dipakai konsisten):

| Brutal | TailAdmin |
|---|---|
| `brutal-border` (3px solid) | `border border-ta-gray-200 dark:border-ta-gray-700` |
| `brutal-shadow`/`-sm`/`-lg` | `shadow-theme-sm`/`shadow-theme-md` |
| `brutal-press` | `transition active:scale-[0.99]` (hover TailAdmin) |
| `rounded-none` | `rounded-xl`/`rounded-2xl` |
| `bg-card`/`bg-background` | `bg-white dark:bg-ta-gray-800` |
| `bg-brutal-bg`/`brutal-bg-lines` | `bg-ta-gray-50 dark:bg-ta-gray-900` |
| `bg-accent`/`bg-primary` | `bg-brand-500 text-white` |
| `bg-muted` | `bg-ta-gray-100 dark:bg-ta-gray-700` |
| `bg-destructive` | `bg-ta-error text-white` |
| `text-foreground` | `text-ta-gray-900 dark:text-white` |
| `text-muted-foreground` | `text-ta-gray-500 dark:text-ta-gray-400` |
| `text-primary-foreground`/`text-accent-foreground` | `text-white` |
| `font-display` (heading uppercase brutal) | `font-outfit` + bobot TailAdmin; uppercase dipertahankan hanya untuk label kecil |

Animasi netral (`brutal-shimmer`/`brutal-pop-in`/`brutal-shake`) = motion, bukan look brutal → **boleh dipertahankan** (di SyncDialog) selama kontainernya di-TailAdmin-kan. Nama class-nya tetap (rename = churn tanpa nilai).

## File & Perubahan

### 1. `Header.tsx` (dipakai stasiun SS + 6 halaman publik)
Restyle in-place ke TailAdmin + dark. Struktur baru (mobile-first, full-width sticky):
- Kiri: `<img lime-logo>` + `RoleEmblem label="SS"`.
- Kanan: `readyCount` pill (hanya bila `totalCount>0`) + help icon-link (ke `/help`) + `ThemeToggle` + (bila `userName`/`onLogout`: `ProfileMenu name=userName canChangePassword:false onLogout`, else tombol logout kecil untuk halaman publik).
- Buang `brutal-*`, `bg-brutal-bg`, `font-display`, bar mobile help brutal → jadi TailAdmin (help tetap aksesibel; bar mobile → tombol/notice TailAdmin).
- `restoLabel` line → TailAdmin teks kecil.
- **Tanpa bell** (SS gak punya feed).

### 2. `Footer.tsx`
Satu gaya TailAdmin (buang cabang `isDark` brutal/light dua-mode). `bg-white dark:bg-ta-gray-800` + `border-ta-gray-200 dark:border-ta-gray-700`, teks `text-ta-gray-500 dark:text-ta-gray-400`, link brand-500. Dipakai stasiun + publik → otomatis seragam.

### 3. `TableButton.tsx`
Kotak meja → TailAdmin: `rounded-xl border shadow-theme-sm`, status: ready=`bg-white dark:bg-ta-gray-800 text-ta-gray-900 dark:text-white`, playing=`bg-brand-500 text-white`, empty=`bg-ta-gray-100 dark:bg-ta-gray-700 text-ta-gray-400`, loading=`animate-pulse`. Label KOSONG/PLAY/SIAP + ikon volume tetap, di-TailAdmin-kan.

### 4. `SoundboardGrid.tsx`
Grid + drawer pengumuman + tombol trigger fixed → TailAdmin + dark (pakai mapping). `border-2 border-foreground` → `border-ta-gray-200 dark:border-ta-gray-700`; `bg-primary`/`bg-card` → brand/white; `font-display uppercase` → TailAdmin.

### 5. `SyncDialog.tsx`
Overlay + panel → TailAdmin (`bg-black/50` overlay; panel `bg-white dark:bg-ta-gray-800 rounded-2xl border shadow-theme-md`). Progress bar + tombol → TailAdmin. Animasi shimmer/pop/shake boleh tetap.

### 6. `RestaurantCredentialDialog.tsx`
`DialogContent` + input + tombol → TailAdmin + dark (buang `brutal-border`/`bg-accent`/`font-display`).

### 7. `routes/index.tsx` (stasiun SS)
- Wrapper `brutal-bg-lines ... min-h-screen` → `min-h-[100svh] bg-ta-gray-50 dark:bg-ta-gray-900` (atau bungkus `ThemeFrame` biar dark class aktif — **penting**: SS saat ini TIDAK dibungkus ThemeFrame, jadi `.dark` gak pernah aktif di SS; SP3 harus membungkus SS dengan `ThemeFrame` supaya `ThemeToggle` berfungsi).
- `<Header/>` tetap (sudah di-restyle) — sekarang dapat `ThemeToggle` yang berfungsi karena `ThemeFrame`.
- Judul "Pilih Nomor Meja" `font-display` → TailAdmin.
- "Belum ada audio" box + tombol "Stop" → TailAdmin + dark.
- `<Footer/>` tetap (restyled).

### 8. 6 halaman publik (`about/contact/faq/help/privacy-policy/terms-of-use`)
Ganti `brutal-border brutal-shadow*` card → TailAdmin card (`bg-white dark:bg-ta-gray-800 border-ta-gray-200 dark:border-ta-gray-700 rounded-2xl shadow-theme-sm`); `font-display uppercase` heading → TailAdmin; `bg-accent` icon boxes → `bg-brand-50 text-brand-500`; `details/summary` → TailAdmin. `<Header/>`+`<Footer/>` sudah restyled (ikut).

### 9. `routes/__root.tsx` (404 + error boundary)
`brutal-border brutal-shadow-lg bg-card` → TailAdmin card + dark; `font-display` → TailAdmin; tombol → `taPrimaryButtonClass`/`taSecondaryButtonClass`.

### 10. `styles.css` (cleanup, guarded)
Setelah grep `brutal-border|brutal-shadow|brutal-press|brutal-bg-lines` = 0 referensi di `src/`, hapus `@utility brutal-border/-shadow/-shadow-lg/-shadow-sm/-press` + `.brutal-bg-lines` (bila utility). **Pertahankan** `--brutal-*` color vars + `--background/--foreground` (dipakai base shadcn `bg-background`/`border`) + animasi `brutal-shimmer/pop-in/shake` (masih dipakai SyncDialog). Kalau masih ada referensi, JANGAN hapus (STOP).

## Testing (source-assertion)

- `ss-debrutalism.test.ts`: untuk SETIAP file target (`Header,Footer,TableButton,SoundboardGrid,SyncDialog,RestaurantCredentialDialog,routes/index,routes/about,contact,faq,help,privacy-policy,terms-of-use,routes/__root`): `expect(src).not.toContain("brutal-border")` dan `not.toContain("brutal-shadow")` dan `not.toContain("bg-brutal-bg")`. (Animasi `brutal-shimmer` dkk di SyncDialog dikecualikan dari assertion ini.)
- `ss-header.test.ts`: `Header.tsx` `toContain("RoleEmblem")`, `toContain("ThemeToggle")`, `toContain("lime-logo.webp")`, `not.toContain("brutal-border")`.
- `ss-theme.test.ts`: `routes/index.tsx` `toContain("ThemeFrame")` (biar dark aktif di SS).
- `tailadmin-tokens.test.ts` (sudah ada) tetap hijau.
- Gate: `npm run verify` exit 0.

## Edge / Risiko

- **SS belum punya ThemeFrame** → `ThemeToggle` di header SS gak akan ngapa-ngapain tanpa pembungkus theme. WAJIB bungkus SS dengan `ThemeFrame` (Task index).
- `Header` dipakai publik (tanpa userName) → pastikan cabang render aman (ProfileMenu vs tombol logout).
- Menghapus `@utility brutal-*` kalau masih ada yang pakai = styling hilang diam-diam (Tailwind unknown class = no-op, bukan error). Karena itu cleanup DI AKHIR + grep guard.
- Tidak ada perubahan DB/RPC/logika audio/realtime/wake-lock. Murni tampilan.

## Di Luar Scope

- Mengubah fungsi/flow SS (tetap: panggil meja, putar audio, sinkron, wake-lock).
- Rename class animasi brutal-* (dipertahankan).
