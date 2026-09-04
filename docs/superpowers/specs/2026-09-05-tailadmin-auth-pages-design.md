# TailAdmin Auth Pages + Manager Footer Dark — Design

Tanggal: 2026-09-05
Cabang: `feat/tailadmin-theme` (lanjutan overhaul TailAdmin)
Status: disetujui user (2026-09-05)

## Tujuan

Bawa gaya TailAdmin ke halaman auth (login & register Manager, plus login global
crew) dengan input berikon di dalam field yang hemat tinggi; pindahkan logo ke
dalam kartu pada login global; hapus ikon hero "toko"; dan betulkan footer
dashboard Manager yang belum ikut dark mode.

## Non-goals

- Tidak mengubah logika auth apa pun (login/register/claim session/PIN/step).
- Halaman auth tidak ikut dark mode (tetap terang; toggle hanya di dashboard).
- Tidak menyentuh `AuthGate` (Owner Console) — di luar permintaan.

## Keputusan desain (dari user)

1. "Logo toko" yang dihapus = kotak ikon hero di atas step (Store di Kode,
   KeyRound di PIN). Ikon per-role di list station TETAP.
2. Input TailAdmin: ikon + placeholder di DALAM field, tanpa baris label terlihat
   (label jadi `aria-label`), hemat tinggi.
3. Login global: logo LIME dipindah ke DALAM kartu (paling atas, tengah), seperti
   halaman login manager.

## Arsitektur

### Primitif auth baru — `src/components/dashboard/auth.tsx`

- `taIconInputClass` — dasar input TailAdmin (sama seperti `taControlClass` tanpa
  `mt-1.5`, sudah `pl-11` untuk ikon kiri, plus varian `dark:`).
- `IconField({ icon, trailing, ...inputProps })` — `<div relative>` + ikon kiri
  absolute + `<input>` yang meneruskan SEMUA prop DOM input (`id`, `type`,
  `placeholder`, `value`, `onChange`, `required`, `autoFocus`, `inputMode`,
  `maxLength`, `autoComplete`, `className`, `aria-label`). Slot `trailing` kanan
  (untuk tombol show/hide). `aria-label` dipakai sebagai label aksesibilitas.
- `AuthShell({ logo, title, subtitle, children, footer })` — page tengah
  `bg-ta-gray-50 font-outfit` + kartu `rounded-2xl border-ta-gray-200 bg-white
  shadow-theme-md` + container logo (`grid size-16 place-items-center rounded-2xl
  bg-brand-50`) + judul + subjudul + children + footer. Dipakai login & register
  Manager.

### Manager login (`src/routes/manager/login.tsx`)

- Pakai `AuthShell` (logo `<img /lime-logo.webp>` di container, title "Login
  Manager").
- `IconField` ID Manager (ikon `IdCard`/`User`, `aria-label="ID Manager"`,
  `placeholder="ID Manager"`) + Password (ikon `Lock`, `placeholder="Password"`,
  `type` toggle, trailing tombol `Eye`/`EyeOff`).
- **Baru:** state `showPassword`; **validasi** — `canSubmit = idManager.trim() &&
  password`, tombol submit `disabled={!canSubmit || busy}`; hint inline bila kosong.
- Logic `loginManager` + `writeManagerIdentity` + `navigate({ to: "/manager" })`
  TETAP. Link "membuat ID MANAGER BARU" TETAP (jaga string tes).

### Manager register (`src/routes/manager/register.tsx`)

- Restyle ke `AuthShell` + `IconField` (Nama `User`, ID Manager `IdCard`, Kode
  Resto `Store`, Password & Konfirmasi `Lock` + trailing show/hide).
- **Semua logic TETAP**: debounce `loginToRestaurant`, `restoValid`/`CheckCircle2`,
  `showPassword`/`EyeOff`, `canSubmit`, pesan "tidak cocok", `registerManager`,
  `navigate({ to: "/manager/login" })`.
- String yang dites (`Nama Lengkap`, `ID Manager`, `Kode Resto`, `Ketik Ulang`)
  dipertahankan lewat `aria-label`/`placeholder`/teks status.

### Login global (`src/components/RoleLoginFlow.tsx`) — presentasional saja

- Kartu jadi TailAdmin: `rounded-2xl border-ta-gray-200 bg-white shadow-theme-md`;
  page `bg-ta-gray-50 font-outfit`. Aksen cyan/fuchsia → `brand`.
- **Logo LIME dipindah ke dalam kartu** (paling atas, tengah, dalam container
  `bg-brand-50`); blok logo di atas kartu dihapus.
- **Hapus kotak hero**: `Store` (step code) + `KeyRound` (step pin). Buang import
  `Store`/`KeyRound` (tak terpakai → lint). Ikon per-role (`ROLE_META`) TETAP.
- **Hapus** teks "Masukkan Kode Resto yang diberikan admin."
- **Ganti** judul step code "Masuk ke Resto" → "Login Dulu".
- Input kode/PIN/nama/`datetime-local` pakai `IconField` (teruskan `id`,
  `type="datetime-local"`, `inputMode`, `maxLength`, `placeholder`, `required`,
  `autoFocus`). Tombol lanjut/submit pakai `taPrimaryButtonClass`.
- Step-indicator + kotak "Login MANAGER" di-restyle brand (tetap fungsional).
- **Logic 100% utuh**: `loginToRestaurant({ data: { code } })`,
  `verifyRestaurantPin`, `claimRoleSession`, `normalizeCrewName`,
  `jakartaCheckedInAtToIso`, `ensureAnonAccessToken`, `onSsContinue`/
  `onRoleContinue`, `setStep`, `backTo*`. **Tanpa** `type="password"` (kode/PIN
  plain text). `id="restaurant-code"` tetap ada.

### Footer dashboard Manager (`src/components/ManagerLayout.tsx`)

- Kartu footer `bg-white border-ta-gray-200` → tambah `dark:bg-ta-gray-800
  dark:border-ta-gray-700`; teks "XDIRGA LABS" `text-ta-gray-400` sudah gelap-safe;
  pastikan kontras (tambah `dark:` seperlunya).

## Alur data

Tidak berubah. Hanya lapisan tampilan + dua state lokal baru di manager login
(`showPassword`, validasi `canSubmit`).

## Penanganan error & tepi

- `IconField` wajib meneruskan `id` + `aria-label` supaya label & `htmlFor`/focus
  tetap benar; semua field auth punya `aria-label`.
- Manager login validasi ringan (non-empty) — bukan pengganti cek server; pesan
  error server (`result.message`) tetap tampil.
- RoleLoginFlow: PIN tetap `onlyDigits(...,4)` + `disabled={pin.length !== 4}`.
- Auth pages terang: `AuthShell`/kartu tidak pakai varian `dark:` wajib (aman
  walau class `dark` tak pernah dipasang di luar AppShell).

## Pengujian (TDD, MERAH dulu)

- `tests/auth-ui.test.ts` (baru, source-assertion): `auth.tsx` punya `IconField`
  (`aria-label`, `pl-11`, `trailing`), `AuthShell` (`bg-brand-50`, `shadow-theme-md`),
  `taIconInputClass` (`dark:bg-ta-gray-900`).
- `tests/manager-auth-routes.test.ts`: login — tambah assert `showPassword`,
  `EyeOff`, `IconField`, `disabled={!canSubmit || busy}`, `taPrimaryButtonClass`;
  string lama (`ID Manager`, `Password`, `membuat ID MANAGER BARU`, `loginManager`,
  `navigate({ to: "/manager" })`, `writeManagerIdentity`) tetap; register — assert
  `IconField` + semua string/logic lama tetap.
- `tests/role-login-flow.test.ts`: tambah assert ada "Login Dulu", TIDAK ada
  "Masuk ke Resto", TIDAK ada "Masukkan Kode Resto yang diberikan admin.", TIDAK
  ada `<Store`/`<KeyRound` hero, ada `taPrimaryButtonClass`/`IconField`, logo
  `<img` ada di dalam kartu; SEMUA assert logic lama tetap hijau.
- `tests/manager-layout.test.ts`: footer punya `dark:bg-ta-gray-800`.
- Regresi: `restaurant-login-build.test.ts` + `manager-entry-button.test.ts` tetap
  hijau; `npm run verify` exit 0.

## Verifikasi akhir

`npm run verify` exit 0. Push branch (dengan izin) → cek preview `/manager/login`,
`/manager/register`, `/` (login global), dan footer dashboard.
