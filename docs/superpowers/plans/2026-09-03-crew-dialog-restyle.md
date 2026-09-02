# Crew Dialog Restyle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti gaya tombol di 3 dialog konfirmasi crew (Kasir/Satgas/Clear Up) dari gaya Super Admin ke token gaya crew polos, tanpa mengubah perilaku.

**Architecture:** Tambah dua token class bersama (`crewPrimaryButtonClass`, `crewSecondaryButtonClass`) ke `src/components/CrewHeader.tsx` (sumber tunggal gaya crew), lalu swap className di 3 dialog route. Test kontrak baru membaca source string (konvensi repo: test source-string).

**Tech Stack:** React 19 + TanStack Start, shadcn `AlertDialog` (Radix), Tailwind 4, Vitest (source-string contract tests).

**Spec:** `docs/superpowers/specs/2026-09-03-crew-dialog-restyle-design.md`

---

### Task 1: Test kontrak MERAH

**Files:**
- Create: `tests/crew-dialog-restyle.test.ts`

- [ ] **Step 1: Tulis test gagal**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Restyle dialog konfirmasi crew (Kasir/Satgas/Clear Up): isi dialog harus
// memakai token gaya crew dari CrewHeader, bukan lagi token gaya Super Admin
// (ownerPrimaryButtonClass). Perilaku/teks/handler tidak berubah -- test
// kontrak dialog yang ada di kasir-route/satgas-route/clear-up-route tetap
// menjadi pengawas.
const crewHeader = () =>
  readFileSync(new URL("../src/components/CrewHeader.tsx", import.meta.url), "utf8");

const route = (name: string) =>
  readFileSync(new URL(`../src/routes/${name}/index.tsx`, import.meta.url), "utf8");

const dialogBlock = (source: string) => source.match(/<AlertDialog[\s\S]*?<\/AlertDialog>/)?.[0];

it("ships shared crew dialog button tokens from CrewHeader", () => {
  const source = crewHeader();
  expect(source).toContain("export const crewPrimaryButtonClass");
  expect(source).toContain("export const crewSecondaryButtonClass");
});

it("kasir dialog uses crew tokens instead of owner styles", () => {
  const dialog = dialogBlock(route("kasir"));
  expect(dialog).not.toBeNull();
  expect(dialog).toContain("crewPrimaryButtonClass");
  expect(dialog).toContain("crewSecondaryButtonClass");
  expect(dialog).not.toContain("ownerPrimaryButtonClass");
});

it("satgas dialog uses crew tokens instead of owner styles", () => {
  const dialog = dialogBlock(route("satgas"));
  expect(dialog).not.toBeNull();
  expect(dialog).toContain("crewPrimaryButtonClass");
  expect(dialog).toContain("crewSecondaryButtonClass");
  expect(dialog).not.toContain("ownerPrimaryButtonClass");
});

it("clear-up dialog uses crew tokens instead of owner styles", () => {
  const dialog = dialogBlock(route("clear-up"));
  expect(dialog).not.toBeNull();
  expect(dialog).toContain("crewPrimaryButtonClass");
  expect(dialog).toContain("crewSecondaryButtonClass");
  expect(dialog).not.toContain("ownerPrimaryButtonClass");
});
```

Catatan: match `<AlertDialog` dimulai dari elemen root dialog sehingga region
yang dicek tidak menyentuh pemakaian `ownerPrimaryButtonClass` di luar dialog
(tombol "Konfirmasi" daftar tunggu escort di `satgas/index.tsx:317` --
out of scope sesuai spec).

- [ ] **Step 2: Jalankan, pastikan MERAH**

Run: `npm test -- tests/crew-dialog-restyle.test.ts`
Expected: FAIL (token belum diekspor; dialog masih memakai ownerPrimaryButtonClass). 4 fail.

---

### Task 2: Token gaya crew di CrewHeader

**Files:**
- Modify: `src/components/CrewHeader.tsx` (setelah blok `LEGEND_DOT_CLASS`, baris ~18)

- [ ] **Step 1: Tambah ekspor token**

```ts
// Shared crew button tokens: the plain, light crew look (rounded-xl, soft
// slate borders, thumb-friendly min height) used by crew confirmation
// dialogs. Not the Super Admin (owner) styles -- see
// docs/superpowers/specs/2026-09-03-crew-dialog-restyle-design.md.
export const crewPrimaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-900/15 disabled:pointer-events-none disabled:opacity-45";

export const crewSecondaryButtonClass =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 disabled:pointer-events-none disabled:opacity-45";
```

---

### Task 3: Swap dialog Kasir

**Files:**
- Modify: `src/routes/kasir/index.tsx:19-20, 226, 228`

- [ ] **Step 1: Perbaiki import**

Baris 19-20, dari:

```ts
import { OwnerNotice, OwnerPage, OwnerRetry, ownerPrimaryButtonClass } from "@/components/OwnerUi";
import { CrewHeader, CrewTableSection } from "@/components/CrewHeader";
```

menjadi:

```ts
import { OwnerNotice, OwnerPage, OwnerRetry } from "@/components/OwnerUi";
import {
  CrewHeader,
  CrewTableSection,
  crewPrimaryButtonClass,
  crewSecondaryButtonClass,
} from "@/components/CrewHeader";
```

- [ ] **Step 2: Swap tombol dialog**

`<AlertDialogCancel onClick={() => setConfirmTable(null)}>Batal</AlertDialogCancel>`
menjadi:

```tsx
<AlertDialogCancel className={crewSecondaryButtonClass} onClick={() => setConfirmTable(null)}>
  Batal
</AlertDialogCancel>
```

`<AlertDialogAction className={ownerPrimaryButtonClass}` menjadi
`<AlertDialogAction className={crewPrimaryButtonClass}` (handler onClick tidak berubah).

---

### Task 4: Swap dialog Satgas

**Files:**
- Modify: `src/routes/satgas/index.tsx:30, 390, 392`

- [ ] **Step 1: Perbaiki import** (pertahankan `ownerPrimaryButtonClass` -- dipakai tombol waitlist di luar dialog, out of scope)

Baris 30, dari:

```ts
import { CrewHeader, CrewTableSection } from "@/components/CrewHeader";
```

menjadi:

```ts
import {
  CrewHeader,
  CrewTableSection,
  crewPrimaryButtonClass,
  crewSecondaryButtonClass,
} from "@/components/CrewHeader";
```

- [ ] **Step 2: Swap tombol dialog**

`<AlertDialogCancel onClick={() => setEscortTable(null)}>Batal</AlertDialogCancel>`
menjadi:

```tsx
<AlertDialogCancel className={crewSecondaryButtonClass} onClick={() => setEscortTable(null)}>
  Batal
</AlertDialogCancel>
```

`<AlertDialogAction className={ownerPrimaryButtonClass}` (baris 392, dialog escort -- BUKAN baris 317 waitlist)
menjadi `<AlertDialogAction className={crewPrimaryButtonClass}`.

---

### Task 5: Swap dialog Clear Up

**Files:**
- Modify: `src/routes/clear-up/index.tsx:29-36, 246, 248`

- [ ] **Step 1: Perbaiki import** (hapus `ownerPrimaryButtonClass` dari import OwnerUi -- satu-satunya pemakaian ada di dialog)

Baris 29-36, dari:

```ts
import {
  OwnerEmpty,
  OwnerNotice,
  OwnerPage,
  OwnerRetry,
  ownerPrimaryButtonClass,
} from "@/components/OwnerUi";
import { CrewHeader, CrewTableSection } from "@/components/CrewHeader";
```

menjadi:

```ts
import { OwnerEmpty, OwnerNotice, OwnerPage, OwnerRetry } from "@/components/OwnerUi";
import {
  CrewHeader,
  CrewTableSection,
  crewPrimaryButtonClass,
  crewSecondaryButtonClass,
} from "@/components/CrewHeader";
```

- [ ] **Step 2: Swap tombol dialog**

`<AlertDialogCancel onClick={() => setConfirmTable(null)}>Batal</AlertDialogCancel>`
menjadi:

```tsx
<AlertDialogCancel className={crewSecondaryButtonClass} onClick={() => setConfirmTable(null)}>
  Batal
</AlertDialogCancel>
```

`<AlertDialogAction className={ownerPrimaryButtonClass}` menjadi
`<AlertDialogAction className={crewPrimaryButtonClass}`.

---

### Task 4/5 lanjutan: HIJAU

- [ ] **Step: Jalankan test focused**

Run: `npm test -- tests/crew-dialog-restyle.test.ts tests/kasir-route.test.ts tests/satgas-route.test.ts tests/clear-up-route.test.ts`
Expected: PASS semua (4 test baru + test kontrak dialog lama tetap hijau).

---

### Task 6: Gate penuh + commit + push + verifikasi target

- [ ] **Step 1: Full gate**

Run: `npm run verify` (test + typecheck + lint + build)
Expected: exit 0.

- [ ] **Step 2: Review diff**

Run: `git diff` sebelum commit. Harus hanya: CrewHeader.tsx (+token), 3 route (import + className), tests/crew-dialog-restyle.test.ts (baru). Nol perubahan handler/teks.

- [ ] **Step 3: Commit + push**

```bash
git add src/components/CrewHeader.tsx src/routes/kasir/index.tsx src/routes/satgas/index.tsx src/routes/clear-up/index.tsx tests/crew-dialog-restyle.test.ts
git commit -m "style: restyle crew confirmation dialogs with shared crew tokens"
git push origin main
```

- [ ] **Step 4: Verifikasi**

- `git fetch origin main && git rev-parse origin/main` == HEAD lokal.
- CI migrations replay tidak terpicu (commit tak menyentuh `supabase/`; path filter) -- normal.
- Vercel: deployment SHA baru READY production; alias `lihatmeja.com` + `qris-order.lihatmeja.com` pada deployment itu; probe HTTP 200.

---

## Self-review

1. Spec coverage: token seragam (Task 2), Batal sekunder (Task 3-5), kotak dialog pakai gaya bawaan (tidak diubah -- sesuai keputusan 3), perilaku tak berubah (test lama jadi pengawas), satu sumber token (Task 2), out-of-scope waitlist tetap utuh (Task 4 Step 1 menjaga import). ✓
2. Placeholder scan: tidak ada TBD/TODO; semua step punya kode exact. ✓
3. Type consistency: `crewPrimaryButtonClass`/`crewSecondaryButtonClass` konsisten di semua task. ✓
