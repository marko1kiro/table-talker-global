# SP3 — SS & Public Pages De-brutalism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buang total neo-brutalism dari stasiun SS + `Header`/`Footer`/`TableButton`/`SoundboardGrid`/`SyncDialog`/`RestaurantCredentialDialog` + 6 halaman publik + 404/error; ganti ke TailAdmin + dark.

**Architecture:** Restyle in-place per file pakai **tabel mapping brutal→TailAdmin** di spec (`docs/superpowers/specs/2026-09-06-ss-debrutalism-design.md`). `Header` (dipakai SS + publik) jadi TailAdmin + `RoleEmblem "SS"` + `ThemeToggle` + `ProfileMenu`/logout + readyCount + help, **tanpa bell**. SS **wajib** dibungkus `ThemeFrame` biar dark aktif. Cleanup `@utility brutal-*` di akhir (guarded grep).

**Tech Stack:** React 19, TanStack, lucide-react, Tailwind (ta-* + `dark:`), Vitest source-assertion.

**Konvensi:** named imports only; `npx prettier --write <file>` tiap edit; `npm run verify` exit 0 sebelum push; push branch `feat/global-header-notification-center` (BUKAN main).

**Cara kerja tiap task restyle:** buka file, ganti SEMUA kemunculan token brutal sesuai tabel mapping (kiri→kanan), tambah varian `dark:`, hapus `font-display`/`rounded-none`/`brutal-*`. Jangan ubah logika/props/fungsi.

---

## Task 1: `Header.tsx` → TailAdmin + cluster (SS + publik)

**Files:** Modify `src/components/Header.tsx`; Test `tests/ss-debrutalism.test.ts` (baru).

- [ ] Step 1: Test MERAH — buat `tests/ss-debrutalism.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const clean = (p: string) => {
  const s = read(p);
  expect(s).not.toContain("brutal-border");
  expect(s).not.toContain("brutal-shadow");
  expect(s).not.toContain("bg-brutal-bg");
};
describe("SS/public de-brutalism", () => {
  it("Header.tsx", () => clean("../src/components/Header.tsx"));
  it("Header uses the TailAdmin cluster (emblem + toggle), no bell", () => {
    const s = read("../src/components/Header.tsx");
    expect(s).toContain("RoleEmblem");
    expect(s).toContain("ThemeToggle");
    expect(s).toContain("lime-logo.webp");
    expect(s).not.toContain("NotificationCenter");
  });
});
```
- [ ] Step 2: Run `npx vitest run tests/ss-debrutalism.test.ts` → FAIL.
- [ ] Step 3: Restyle `Header.tsx`:
  - Impor `RoleEmblem`, `ThemeToggle`, `ProfileMenu` dari `@/components/dashboard/*`.
  - Root `<header>`: `sticky top-0 z-40 border-b border-ta-gray-200 bg-white/95 backdrop-blur dark:border-ta-gray-700 dark:bg-ta-gray-800/95`.
  - Kiri: `<img lime-logo>` + `<RoleEmblem label="SS" />`.
  - Kanan: `readyCount` pill (`totalCount>0`: `rounded-full bg-ta-gray-100 px-2.5 py-1 text-xs font-bold text-ta-gray-600 dark:bg-ta-gray-700 dark:text-ta-gray-300`), help `<Link to="/help">` ikon `LifeBuoy` (`text-ta-gray-500 hover:text-brand-500`), `<ThemeToggle/>`, lalu `userName ? <ProfileMenu name={userName} canChangePassword={false} onLogout={onLogout}/> : (onLogout && <button ...TailAdmin logout.../>)`.
  - Bar mobile help brutal → hapus/ubah jadi teks TailAdmin kecil (opsional; yang penting bukan brutal). `restoLabel` line → `text-xs text-ta-gray-500 dark:text-ta-gray-400`.
  - Buang SEMUA `brutal-*`, `bg-brutal-bg`, `font-display`, `text-foreground`, `bg-card`, `bg-accent`, `bg-destructive`, `rounded-none`.
- [ ] Step 4: prettier + run → PASS.
- [ ] Step 5: Commit `git add src/components/Header.tsx tests/ss-debrutalism.test.ts && git commit -m "feat(ss): Header to TailAdmin cluster (emblem+toggle+profile, no bell)"`.

---

## Task 2: `Footer.tsx` → TailAdmin

**Files:** Modify `src/components/Footer.tsx`; Test tambah `it("Footer.tsx", () => clean("../src/components/Footer.tsx"));` ke `ss-debrutalism.test.ts`.

- [ ] Step 1: Tambah `it` Footer → run → FAIL.
- [ ] Step 2: Restyle `Footer.tsx`: buang cabang `isDark` brutal/light dua-mode → satu TailAdmin: `border-t border-ta-gray-200 bg-white dark:border-ta-gray-700 dark:bg-ta-gray-800`, teks `text-ta-gray-500 dark:text-ta-gray-400`, link `text-brand-500`. `font-display`→TailAdmin.
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): Footer to TailAdmin (drop brutal light/dark split)"`.

---

## Task 3: `TableButton.tsx` → TailAdmin

**Files:** Modify `src/components/TableButton.tsx`; Test `it("TableButton.tsx", ...)`.

- [ ] Step 1: Tambah `it` → FAIL.
- [ ] Step 2: `base` → `relative flex aspect-square w-full select-none flex-col items-center justify-center rounded-xl border shadow-theme-sm transition active:scale-[0.99] disabled:cursor-not-allowed border-ta-gray-200 dark:border-ta-gray-700`. `state`: playing `bg-brand-500 text-white shadow-theme-md`; empty `bg-ta-gray-100 text-ta-gray-400 dark:bg-ta-gray-700 dark:text-ta-gray-500`; ready `bg-white text-ta-gray-900 dark:bg-ta-gray-800 dark:text-white`. Label/ikon → TailAdmin (buang `font-display`).
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): TableButton to TailAdmin + dark"`.

---

## Task 4: `SoundboardGrid.tsx` → TailAdmin

**Files:** Modify `src/components/SoundboardGrid.tsx`; Test `it("SoundboardGrid.tsx", ...)`.

- [ ] Step 1: Tambah `it` → FAIL.
- [ ] Step 2: Terapkan mapping ke grid item, drawer pengumuman (`bg-card`→`bg-white dark:bg-ta-gray-800`, `border-2 border-foreground`→`border-ta-gray-200 dark:border-ta-gray-700`, `bg-primary`→`bg-brand-500 text-white`), tombol trigger fixed (`bg-primary font-display`→`bg-brand-500 text-white rounded-full shadow-theme-md`). Buang `brutal-*`/`font-display`.
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): SoundboardGrid to TailAdmin + dark"`.

---

## Task 5: `SyncDialog.tsx` → TailAdmin

**Files:** Modify `src/components/SyncDialog.tsx`; Test `it("SyncDialog.tsx", ...)` (hanya cek `brutal-border`/`brutal-shadow`/`bg-brutal-bg`; animasi `brutal-shimmer/pop-in/shake` boleh tetap).

- [ ] Step 1: Tambah `it` → FAIL.
- [ ] Step 2: Overlay `bg-brutal-fg/60`→`bg-black/50`; panel `brutal-border brutal-shadow-lg ... rounded-none bg-card`→`rounded-2xl border border-ta-gray-200 bg-white shadow-theme-md dark:border-ta-gray-700 dark:bg-ta-gray-800`; progress track `brutal-border ... bg-muted`→`bg-ta-gray-100 dark:bg-ta-gray-700`; tombol `brutal-border ... bg-accent`→`bg-brand-500 text-white`. `font-display`→TailAdmin. Animasi shimmer/pop/shake TETAP.
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): SyncDialog to TailAdmin + dark"`.

---

## Task 6: `RestaurantCredentialDialog.tsx` → TailAdmin

**Files:** Modify `src/components/RestaurantCredentialDialog.tsx`; Test `it("RestaurantCredentialDialog.tsx", ...)`.

- [ ] Step 1: Tambah `it` → FAIL.
- [ ] Step 2: `DialogContent` `brutal-border brutal-shadow-lg`→TailAdmin (`rounded-2xl border ... bg-white dark:bg-ta-gray-800`); `DialogTitle font-display`→TailAdmin; tombol `brutal-border brutal-press w-full bg-accent font-display`→`w-full rounded-xl bg-brand-500 px-4 py-3 font-bold text-white`. Buang `brutal-*`/`font-display`.
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): RestaurantCredentialDialog to TailAdmin + dark"`.

---

## Task 7: `routes/index.tsx` (stasiun SS) — ThemeFrame + TailAdmin

**Files:** Modify `src/routes/index.tsx`; Test `it("routes/index.tsx", ...)` + `it("SS wrapped in ThemeFrame", ...)`.

- [ ] Step 1: Tambah `it`:
```ts
  it("SS station wrapped in ThemeFrame", () => {
    expect(read("../src/routes/index.tsx")).toContain("ThemeFrame");
  });
```
→ run → FAIL.
- [ ] Step 2: `routes/index.tsx`:
  - Impor `ThemeFrame` dari `@/components/dashboard/ThemeFrame`.
  - Bungkus branch `crewIdentity` (`<div className="brutal-bg-lines relative min-h-screen pb-24">`) → `<ThemeFrame>` + `<div className="relative min-h-[100svh] bg-ta-gray-50 pb-24 dark:bg-ta-gray-900">`. (Login branch `RoleLoginFlow` sudah TailAdmin; tak perlu ThemeFrame karena tak butuh dark toggle — tapi kalau `Header`/`Footer` muncul di publik, publik page yang lain yang membungkus.)
  - Judul "Pilih Nomor Meja" `font-display`→TailAdmin; "Belum ada audio" box `brutal-border brutal-shadow bg-card font-display`→TailAdmin card; tombol "Stop" `brutal-border brutal-shadow-lg bg-destructive font-display`→`rounded-full bg-ta-error px-5 py-3 font-bold text-white shadow-theme-md`.
  - Buang `brutal-bg-lines`/`brutal-*`/`font-display`/`bg-card`/`bg-destructive`/`text-muted-foreground`→TailAdmin+dark.
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): station wrapped in ThemeFrame + TailAdmin/dark"`.

---

## Task 8: 6 halaman publik → TailAdmin

**Files:** Modify `src/routes/{about,contact,faq,help,privacy-policy,terms-of-use}.tsx`; Test: 6 `it(...)` (satu per file) di `ss-debrutalism.test.ts`.

- [ ] Step 1: Tambah 6 `it` (satu per halaman) → run → FAIL.
- [ ] Step 2: Tiap halaman: container `brutal-border brutal-shadow-lg bg-card p-6 sm:p-10`→`rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-sm sm:p-10 dark:border-ta-gray-700 dark:bg-ta-gray-800`; `h1 font-display text-2xl uppercase`→`text-2xl font-black sm:text-4xl` (TailAdmin, buang uppercase/font-display); `h2 font-display uppercase`→`text-base font-bold`; item card `brutal-border brutal-shadow-sm bg-background p-4`→`rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4 dark:border-ta-gray-700 dark:bg-ta-gray-900`; icon box `brutal-border bg-accent`→`bg-brand-50 text-brand-500`; `details/summary` (faq) → TailAdmin; tombol (help) → `taPrimaryButtonClass`/TailAdmin. `text-foreground`→`text-ta-gray-900 dark:text-white`.
- [ ] Step 3: prettier (6 file) + run → PASS.
- [ ] Step 4: Commit `git add src/routes/about.tsx ... tests/ss-debrutalism.test.ts && git commit -m "feat(ss): public info pages to TailAdmin + dark"`.

---

## Task 9: `routes/__root.tsx` 404 + error boundary → TailAdmin

**Files:** Modify `src/routes/__root.tsx`; Test `it("routes/__root.tsx", ...)`.

- [ ] Step 1: Tambah `it` → FAIL.
- [ ] Step 2: Dua blok (`brutal-border brutal-shadow-lg max-w-md bg-card p-8`): → `mx-auto max-w-md rounded-2xl border border-ta-gray-200 bg-white p-8 text-center shadow-theme-sm dark:border-ta-gray-700 dark:bg-ta-gray-800`; `text-7xl font-display`→`text-7xl font-black`; heading `font-display uppercase text-foreground`→`font-bold text-ta-gray-900 dark:text-white`; tombol `brutal-border brutal-shadow bg-accent font-display`→TailAdmin (`bg-brand-500 text-white rounded-xl`). `text-foreground`→TailAdmin.
- [ ] Step 3: prettier + run → PASS.
- [ ] Step 4: Commit `... -m "feat(ss): 404 + error boundary to TailAdmin + dark"`.

---

## Task 10: Cleanup `styles.css` (guarded)

**Files:** Modify `src/styles.css`.

- [ ] Step 1: Guard — `rg -n "brutal-border|brutal-shadow|brutal-press|brutal-bg-lines" src/`. Kalau masih ADA referensi → **skip** task ini (biarin utility terdefinisi; tak berbahaya) dan lanjut Task 11. Kalau KOSONG → hapus blok `@utility brutal-border`, `brutal-shadow`, `brutal-shadow-lg`, `brutal-shadow-sm`, `brutal-press`, dan `.brutal-bg-lines` (bila ada). **JANGAN** hapus `--brutal-*` color vars, `--background/--foreground/--border` (dipakai base shadcn), atau `brutal-shimmer/pop-in/shake` (dipakai SyncDialog).
- [ ] Step 2: `npx tsc --noEmit` + `npm run build` (via verify nanti) → pastikan gak ada class hilang yang bikin layout rusak (visual spot-check di preview).
- [ ] Step 3: Commit `git add src/styles.css && git commit -m "chore(ss): remove unused brutal-* utilities"` (hanya bila guard lolos).

---

## Task 11: Full quality gate + push

- [ ] Step 1: `npm run verify` → exit 0. Perbaiki sisa (assertion lama yang cek `brutal`/`font-display`/`Header` struktur lama di test lain → update; impor unused; dsb.).
- [ ] Step 2: `git add -A && git commit -m "chore: satisfy quality gate for SP3 de-brutalism"` (bila ada).
- [ ] Step 3: `git push`.

---

## Self-Review (penulis plan)

- **Cakupan spec:** Header(T1) Footer(T2) TableButton(T3) SoundboardGrid(T4) SyncDialog(T5) CredentialDialog(T6) index+ThemeFrame(T7) publik x6(T8) 404/error(T9) CSS cleanup guarded(T10) gate+push(T11). Semua butir spec ada task.
- **Kritis:** T7 wajib `ThemeFrame` (kalau nggak, `ThemeToggle` SS mati). T10 guarded (grep) biar gak hapus utility yang masih kepakai.
- **Konsistensi:** `clean()` helper dipakai semua task; mapping tunggal di spec; `RoleEmblem "SS"` + no-bell konsisten T1.
- **Test incremental:** `ss-debrutalism.test.ts` nambah satu `it` per task → tetap hijau tiap commit.
