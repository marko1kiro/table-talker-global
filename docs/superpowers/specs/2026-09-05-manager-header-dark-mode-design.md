# Manager Header Cluster + Dark Mode + Sidebar — Design

Tanggal: 2026-09-05
Cabang: `feat/tailadmin-theme` (UI/UX layer, lanjutan overhaul TailAdmin Phase 1)
Status: disetujui user (2026-09-05)

## Tujuan

Bikin header dashboard Manager terasa seperti TailAdmin demo: emblem peran,
toggle dark mode, lonceng notifikasi, dan menu profil (avatar + nama + ganti
password + logout). Menambah dark mode yang berfungsi untuk Manager + Super
Admin, plus merapikan nama resto di sidebar. Semua tetap UI/presentation
layer; auth, realtime, dan query logic tidak berubah.

## Non-goals

- Ganti password **fungsional** (butuh RPC + migrasi). Fase ini tombolnya
  placeholder nonaktif ("Segera hadir").
- Dark mode untuk halaman crew/owner/login publik.
- Mengubah cara login/logout/sesi manager bekerja.

## Keputusan desain (dari user)

1. Ganti password: placeholder dulu.
2. Notifikasi: baris reminder yang muter di dashboard pindah ke lonceng; kartu
   stat "Perlu Dicek" + highlight amber di grid meja TETAP.
3. Dark mode: berlaku Manager + Super Admin, pilihan disimpan di localStorage.

## Arsitektur

### Urutan kanan header (Manager)

`[MANAGER emblem] [ThemeToggle] [NotificationBell] [ProfileMenu]`

- Emblem = pill `MANAGER`, `bg-brand-500 text-white rounded-md`, persis di kiri
  toggle. Manager-only.
- Super Admin = `[ThemeToggle] [ProfileMenu]` saja (tanpa emblem, tanpa bell).
- Tombol "Keluar" lama di header Manager dan Super Admin **dihapus**; logout
  pindah ke dalam `ProfileMenu`.

### Komponen baru

Semua di `src/components/dashboard/` (client components).

- `use-theme.ts` → `useTheme(): { isDark: boolean; toggle: () => void }`.
  - Baca/tulis `localStorage["ta-theme"]` (`"dark" | "light"`, default `"light"`).
  - State saja; **tidak** menyentuh `documentElement`. Class `dark` dipasang di
    root `AppShell` (lihat bawah) supaya crew/owner di origin yang sama tidak
    pernah ikut gelap.
  - Aman SSR: baca storage di dalam `useState` initializer dengan guard
    `typeof window`.
- `ThemeToggle.tsx` → tombol ikon (Sun saat dark, Moon saat light), gaya
  ikon-button TailAdmin (`size-10 rounded-lg border border-ta-gray-200
  bg-white text-ta-gray-600 hover:bg-ta-gray-100`, varian `dark:`). `aria-label`
  "Mode gelap"/"Mode terang".
- `NotificationBell.tsx` → props `{ items: { table: number; duration: string }[] }`.
  - Tombol lonceng + badge jumlah (hilang saat 0). Dropdown (buka/tutup lokal):
    header `Notifikasi (N)`; tiap item = ikon jam amber + `Meja {n} perlu dicek`
    + `>{duration}`; kosong → `Tidak ada meja perlu dicek`.
  - Tutup saat klik di luar / Esc (pola dropdown sederhana, `useRef` + listener).
- `ProfileMenu.tsx` → props `{ name: string; onLogout: () => void }`.
  - Pemicu: avatar placeholder (SVG orang dalam lingkaran `bg-ta-gray-100`) +
    nama (truncate) + ikon chevron.
  - Dropdown: item `Ganti password` (nonaktif, `disabled`, hint "Segera hadir")
    + item `Keluar` (memanggil `onLogout`).
  - Pola buka/tutup sama dengan `NotificationBell`.
- `RoleEmblem.tsx` → `{ label: string }` pill brand. Dipakai ManagerLayout.

### Dark mode: wiring CSS

- `src/styles.css` baris 5: ubah
  `@custom-variant dark (&:is(.dark *));` →
  `@custom-variant dark (&:where(.dark, .dark *));`
  supaya elemen yang **memakai** class `dark` ikut ter-flip, bukan cuma
  turunannya.
- `AppShell` root `<div>` menerima class `dark` saat `isDark`, dan
  `dark:bg-ta-gray-900 dark:text-ta-gray-100`. `AppShell` memanggil `useTheme`
  sendiri (satu sumber kebenaran per shell).
- Palet gelap TailAdmin: halaman `ta-gray-900` (#101828), kartu `ta-gray-800`
  (#1D2939), garis `ta-gray-700` (#344054), teks utama putih, teks sekunder
  `ta-gray-400`, menu aktif `bg-brand-500/10 text-brand-400`.
- Menambah varian `dark:` di: `AppShell` (aside/header/drawer/overlay/nav),
  `dashboard/ui.tsx` (TaCard, TaStatCard, TaPageHeader, TaField, TaBadge,
  TaNotice, TaEmpty, TaLoading, TaRetry, TaPagination, `taControlClass`,
  `taSecondaryButtonClass`), dan permukaan khusus manager di
  `manager/index.tsx` (ToastSlot, legend, kotak meja, tabel crew, log).
  `taPrimaryButtonClass`/`taDangerButtonClass` sudah solid → tidak perlu varian.

### Data notifikasi (presentation logic)

- `src/lib/manager-reminder.ts`:
  - Tambah `buildStaleNotices(tables, nowMs): { table: number; duration: string }[]`
    — hasil `sortedOccupiedTables` difilter `> TWO_HOURS_MS`, dipetakan ke
    `{ table: entry.tableNumber, duration: formatOccupiedDuration(...) }`
    (uppercase, tanpa pembungkus "MEJA ... PERLU DI CEK").
  - `buildStaleReminders` + `rotateIndex` **dihapus** (satu-satunya pemakai,
    baris muter, ikut dihapus). `TWO_HOURS_MS` tetap.
- `manager/index.tsx`:
  - Ganti `reminders`/`reminder`/`rotateIndex` dengan `notices =
    buildStaleNotices(tables, now)`.
  - Hapus blok baris reminder muter (`bg-ta-error`).
  - Stat card "Perlu Dicek" = `notices.length` (tetap).
  - `headerRight` = `<RoleEmblem label="MANAGER" /> <ThemeToggle />
    <NotificationBell items={notices} /> <ProfileMenu name={identity.fullName}
    onLogout={logout} />`.
  - Tick 1 detik (`now`) tetap (menyegarkan umur). Interval rotasi 7 detik
    (`tick`) dicabut.

### Sidebar

- `ManagerLayout` footer: nama resto `text-[13px] font-bold uppercase
  whitespace-nowrap truncate` (1 baris) + jarak ke baris `lihatmeja.com`
  dirapatkan (`mt-2` → `mt-0.5`, leading dikurangi).

## Alur data

Snapshot meja (server fn, tetap) → `tables` → `buildStaleNotices` (client,
per-tick) → `NotificationBell` + stat card. Realtime invalidate (tetap).
Theme: `useTheme` state → class `dark` di root AppShell → varian `dark:` Tailwind.

## Penanganan error & tepi

- `localStorage` unavailable (private mode): `useTheme` fallback `"light"`,
  toggle tetap jalan in-memory (bungkus akses storage dengan try/catch).
- Dropdown: tidak ada fokus-trap penuh (cukup buka/tutup + klik-luar + Esc);
  konsisten dengan pola drawer AppShell.
- Avatar: tanpa gambar eksternal (SVG inline) → tidak ada request/404.
- Nama manager panjang: truncate di pemicu profil.

## Pengujian (TDD, MERAH dulu)

- `manager-reminder.test.ts`: `buildStaleNotices` mengembalikan item terstruktur
  untuk >2 jam saja, terurut; `buildStaleReminders`/`rotateIndex` tak ada lagi.
- `use-theme.test.ts`: default light; toggle flip state; menulis localStorage;
  baca nilai tersimpan saat mount.
- `theme-toggle.test.ts`: render ikon sesuai state; klik memanggil toggle;
  aria-label benar.
- `notification-bell.test.ts`: badge = jumlah; buka menampilkan item `Meja N`;
  kosong → pesan kosong; badge hilang saat 0.
- `profile-menu.test.ts`: menampilkan nama; `Ganti password` disabled;
  `Keluar` memanggil `onLogout`.
- `manager-dashboard-route.test.ts`: emblem `MANAGER` + `ThemeToggle` +
  `NotificationBell` + `ProfileMenu` dirender; baris reminder muter hilang;
  stat card "Perlu Dicek" tetap; `headerRight` tak lagi berisi tombol Keluar
  lama.
- `app-shell.test.ts` / `manager-layout.test.ts`: root dapat class `dark` saat
  isDark; nama resto punya `truncate`/`whitespace-nowrap`; Super Admin header
  punya `ThemeToggle`.
- Regresi: `npm run verify` hijau penuh; crew/owner tak berubah (tanpa varian
  `dark:` di komponen crew, dan class `dark` tak pernah dipasang di luar AppShell).

## Verifikasi akhir

`npm run verify` exit 0 (test + typecheck + lint + build). Preview branch
dicek user sebelum merge ke `main`.
