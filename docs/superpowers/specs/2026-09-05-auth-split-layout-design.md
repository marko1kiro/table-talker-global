# Auth Split Layout (TailAdmin) — Design

Tanggal: 2026-09-05
Cabang: `feat/auth-split-layout` (dari `main`)
Status: disetujui user (2026-09-05, dengan revisi tombol Login Manager)

## Tujuan

Bungkus 3 halaman auth (login global, login manager, register manager) dalam
layout split-screen ala TailAdmin `/signin` `/signup`: kolom form di kiri, panel
branding di kanan. Wajib responsif semua ukuran. Field & logic form yang sekarang
live TETAP (input tetap `IconField`).

## Non-goals

- Tidak mengubah logika auth (loginManager/registerManager/claim session/PIN/step).
- Tidak menambah social login (Google/X) sungguhan.
- Tidak menyentuh halaman dashboard/crew.

## Keputusan desain (dari user)

1. Berlaku untuk login global + login manager + register manager (konsisten).
2. Input tetap `IconField` (ikon di dalam, tanpa label). Hanya layout halaman yang
   berubah ke split demo.
3. Revisi: di login global, slot tombol "Sign in with Google" demo dipakai jadi
   **tombol "Login Manager"** (gaya tombol sekunder demo), **tombol "Sign in with X"
   dihapus** (gak kepake). Lalu divider "Or", baru form Kode Resto.

## Arsitektur

### `AuthLayout` (baru, di `src/components/dashboard/auth.tsx`)

`AuthLayout({ children })`:
- Outer: `relative z-10 flex min-h-[100svh] w-full flex-col bg-white lg:flex-row dark:bg-ta-gray-900`.
- Kolom form: `flex flex-1 flex-col justify-center px-6 py-12 sm:px-10` → dalam
  `mx-auto w-full max-w-md` (children ditaruh di sini, TANPA kartu).
- Panel branding: `relative hidden w-full items-center justify-center overflow-hidden
  bg-brand-950 lg:flex lg:w-1/2 dark:bg-white/5`. Isinya:
  - 2 `<img src="/shape/grid-01.svg">` dekoratif (pojok kanan-atas + kiri-bawah
    `rotate-180`), `pointer-events-none absolute`.
  - Logo LIME di dalam badge putih (`grid place-items-center rounded-2xl bg-white
    px-5 py-3`) biar kontras di panel navy.
  - Tagline `text-ta-gray-400`: "Sistem Panggilan & Status Meja Restoran".
- Responsif: panel `hidden lg:flex` → di bawah `lg` cuma form full-width tengah.

### Dukungan token & aset

- `src/styles.css` `@theme`: tambah `--color-brand-950: #10133a;` (navy panel).
- Re-add `public/shape/grid-01.svg` (aset ini ilang bareng branch `page/coming-soon`
  yang dihapus; isinya sama dengan yang dipakai coming-soon).

### Login global (`src/components/RoleLoginFlow.tsx`)

- Ganti `<main>` pembungkus + kartu `rounded-2xl border bg-white shadow` →
  `<AuthLayout>` dengan konten wizard di kolom form (kartu diilangin).
- Step-indicator tetap di atas heading.
- Step `code`: ganti kotak "Khusus Pimpinan Shift" jadi **tombol "Login Manager"**
  gaya sekunder demo (satu baris full-width, `bg-ta-gray-100 ... hover:bg-ta-gray-200`,
  ikon `UserCog`, `<Link to="/manager/login">`), lalu **divider "Or"**, baru form
  Kode Resto (`IconField` + tombol Lanjutkan). Tombol X TIDAK ada.
- Step `pin`/`role`/`identity`: tetap (badge resto, `IconField`, `taPrimaryButtonClass`,
  `CREW_ROLE_ORDER.map`, dsb). **Semua logic handler TETAP.**
- Constraint tes lama tetap: `id="restaurant-code"`, tanpa `type="password"`, semua
  import + pola logic (`loginToRestaurant({ data: { code } })`, `verifyRestaurantPin`,
  `claimRoleSession`, `normalizeCrewName`, `jakartaCheckedInAtToIso`, `onSsContinue`,
  `onRoleContinue`), `MANAGER` + `to="/manager/login"`.

### Login manager (`src/routes/manager/login.tsx`)

- `AuthShell` → `AuthLayout`. Konten kolom: heading "Login Manager" + subtitle +
  form `IconField` (ID `Hash`, Password `Lock` + show/hide) + error + tombol
  `taPrimaryButtonClass` + link "membuat ID MANAGER BARU". Logic `loginManager`/
  `writeManagerIdentity`/`navigate`/`canSubmit`/`showPassword` TETAP.

### Register manager (`src/routes/manager/register.tsx`)

- `AuthShell` → `AuthLayout`. Konten kolom: heading "Buat ID MANAGER BARU" + form
  `IconField` (Nama/ID/Kode/Password+show-hide/Konfirmasi) + status cek kode
  (`looking`/`restoValid`/`CheckCircle2`) + pesan mismatch + tombol + link balik.
  **Semua logic TETAP** (debounce `loginToRestaurant`, `canSubmit`, `registerManager`).

`AuthShell` jadi tak terpakai (dibiarkan; tanpa error lint untuk unused export).

## Pengujian (TDD, source-assertion)

- `tests/auth-ui.test.ts`: `AuthLayout` ada `lg:flex-row`, `lg:w-1/2`, `bg-brand-950`,
  `grid-01.svg`, `lime-logo.webp`, `hidden` (panel mobile). `styles.css` punya
  `--color-brand-950`. `public/shape/grid-01.svg` ada.
- `tests/manager-auth-routes.test.ts`: login & register assert `AuthLayout` (bukan
  `AuthShell`); semua string/logic lama tetap (`ID Manager`,`Password`,`membuat ID
  MANAGER BARU`,`loginManager`,`navigate({ to: "/manager" })`,`writeManagerIdentity`,
  `showPassword`,`EyeOff`,`canSubmit`,`disabled={!canSubmit || busy}`,`Nama Lengkap`,
  `Kode Resto`,`Ketik Ulang`,`loginToRestaurant`,`looking`,`animate-spin`,`restoValid`,
  `CheckCircle2`,`tidak cocok`,`IconField`,`taPrimaryButtonClass`).
- `tests/role-login-flow.test.ts`: assert `AuthLayout`, tombol "Login Manager" gaya
  sekunder (`bg-ta-gray-100`), divider "Or", TIDAK ada "Sign in with X"; SEMUA assert
  logic + `id="restaurant-code"` + tanpa `type="password"` tetap hijau.
- `tests/manager-entry-button.test.ts`: tetap hijau (`MANAGER` + `to="/manager/login"`).
- Regresi: `restaurant-login-build.test.ts` hijau; `npm run verify` exit 0.

## Verifikasi akhir

`npm run verify` exit 0 → push branch `feat/auth-split-layout` (dengan izin) → cek
preview `/`, `/manager/login`, `/manager/register` di mobile & desktop.
