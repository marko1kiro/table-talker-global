# LIME Brand Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti seluruh brand "TABLE TALKER" menjadi "LIME" di login owner, shell console, halaman publik, footer, meta, dan pesan WhatsApp — tanpa mengubah perilaku.

**Architecture:** Test pengawas baru mengunci nol "TABLE TALKER" di `src` + kehadiran "LIME" di AuthGate/shell; 2 test kontrak lama di-update ke "LIME" dulu (MERAH), lalu rename semua source, HIJAU, gate penuh, push, verifikasi produksi.

**Tech Stack:** React 19 + TanStack Start, Vitest source-string tests.

**Spec:** `docs/superpowers/specs/2026-09-03-lime-brand-rename-design.md`

---

### Task 1: Test MERAH

**Files:**
- Create: `tests/brand-rename.test.ts`
- Modify: `tests/help-page-source.test.ts:9`
- Modify: `tests/help-message.test.ts:13`

- [ ] **Step 1: Tulis test pengawas baru**

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

// Rename brand TABLE TALKER -> LIME: tidak boleh ada lagi brand lama di
// source, dan brand baru wajib hadir di halaman login owner + shell console.
// Cookie "table-talker-session" di auth.server.ts sengaja dipertahankan
// (identifier internal; rename = logout paksa semua sesi owner).
function listFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) files.push(...listFiles(full));
    else files.push(full.split(path.sep).join("/"));
  }
  return files;
}

const sourceFiles = listFiles("src").filter((file) => /\.(ts|tsx)$/.test(file));

it("no remaining TABLE TALKER brand text in src", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf8");
    if (/TABLE TALKER|Table Talker/i.test(content)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});

it("owner login and console shell carry the LIME brand", () => {
  const authGate = readFileSync(new URL("../src/components/AuthGate.tsx", import.meta.url), "utf8");
  expect(authGate).toContain(">LIME</p>");
  expect(authGate).toContain("/lime-logo.webp");
  expect(authGate).toContain("Panggilan meja & operasional resto");
  expect(authGate).toContain("Operasional resto yang cepat, jelas, dan terkendali.");

  const shell = readFileSync(new URL("../src/routes/super-admin/route.tsx", import.meta.url), "utf8");
  expect(shell).toContain('title: "Owner Console - LIME"');
  expect(shell).toContain("/lime-logo.webp");
});

it("public pages use the LIME brand in metadata", () => {
  const landing = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  expect(landing).toContain('title: "LIME - Panggilan Meja"');
  const helpMessage = readFileSync(new URL("../src/lib/help-message.ts", import.meta.url), "utf8");
  expect(helpMessage).toContain("*LAPORAN KENDALA LIME*");
});
```

- [ ] **Step 2: Update 2 test lama ke ekspektasi baru**

`tests/help-page-source.test.ts:9`:
`'{ title: "Bantuan — Table Talker" }'` → `'{ title: "Bantuan — LIME" }'`

`tests/help-message.test.ts:13`:
`"*LAPORAN KENDALA TABLE TALKER*"` → `"*LAPORAN KENDALA LIME*"`

- [ ] **Step 3: Jalankan, pastikan MERAH**

Run: `npm test -- tests/brand-rename.test.ts tests/help-page-source.test.ts tests/help-message.test.ts`
Expected: FAIL (source masih brand lama).

---

### Task 2: AuthGate + shell console owner

**Files:**
- Modify: `src/components/AuthGate.tsx`
- Modify: `src/routes/super-admin/route.tsx`

- [ ] **Step 1: AuthGate — desktop brand lockup (baris ~55-63)**

Dari:

```tsx
<span className="grid size-11 place-items-center rounded-xl bg-amber-400 text-slate-950">
  <ShieldCheck className="size-5" />
</span>
<div>
  <p className="font-black tracking-tight">TABLE TALKER</p>
  <p className="text-xs font-semibold text-slate-400">Restaurant audio operations</p>
</div>
```

menjadi:

```tsx
<img src="/lime-logo.webp" alt="LIME" className="h-8 w-auto shrink-0 select-none" />
<div>
  <p className="font-black tracking-tight">LIME</p>
  <p className="text-xs font-semibold text-slate-400">Panggilan meja & operasional resto</p>
</div>
```

- [ ] **Step 2: AuthGate — headline + footer kecil**

`Operasional audio yang cepat, jelas, dan terkendali.` → `Operasional resto yang cepat, jelas, dan terkendali.`
`Secure access · Table Talker` → `Secure access · LIME`

- [ ] **Step 3: AuthGate — mobile brand lockup (baris ~81-89)**

Dari:

```tsx
<span className="grid size-10 place-items-center rounded-xl bg-amber-400 text-slate-950">
  <ShieldCheck className="size-5" />
</span>
<div>
  <p className="font-black tracking-tight">TABLE TALKER</p>
```

menjadi:

```tsx
<img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
<div>
  <p className="font-black tracking-tight">LIME</p>
```

- [ ] **Step 4: AuthGate — bersihkan import `ShieldCheck` bila sudah tak terpakai**

Cek: `ShieldCheck` dipakai di dua lockup yang diganti → hapus dari import lucide.
`LockKeyhole`, `Loader2`, `ArrowRight` tetap.

- [ ] **Step 5: route.tsx — meta title**

`title: "Owner Console - Table Talker"` → `title: "Owner Console - LIME"`

- [ ] **Step 6: route.tsx — mobile header (baris ~66-71)**

Dari:

```tsx
<span className="grid size-8 place-items-center rounded-lg bg-amber-400 text-slate-950">
  <AudioLines className="size-4" />
</span>
<span className="text-sm font-black tracking-tight">TABLE TALKER</span>
```

menjadi:

```tsx
<img src="/lime-logo.webp" alt="LIME" className="h-7 w-auto shrink-0 select-none" />
<span className="text-sm font-black tracking-tight">LIME</span>
```

- [ ] **Step 7: route.tsx — sidebar brand (baris ~134-143)**

Dari:

```tsx
<span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-400 text-slate-950 shadow-[0_0_0_4px_rgba(251,191,36,0.12)]">
  <AudioLines className="size-5" />
</span>
<div>
  <p className="text-base font-black tracking-tight text-white">TABLE TALKER</p>
```

menjadi:

```tsx
<img src="/lime-logo.webp" alt="LIME" className="h-8 w-auto shrink-0 select-none" />
<div>
  <p className="text-base font-black tracking-tight text-white">LIME</p>
```

(`ShieldCheck` "Owner Console" di bawahnya tetap.)

- [ ] **Step 8: route.tsx — bersihkan import `AudioLines` bila tak terpakai lagi**

---

### Task 3: Rename halaman publik + console + footer + pesan WA

**Files:**
- Modify: `src/routes/super-admin/index.tsx` (2x), `src/components/Footer.tsx` (1x),
  `src/routes/index.tsx` (2x), `src/routes/about.tsx` (5x), `src/routes/faq.tsx` (6x),
  `src/routes/help.tsx` (4x), `src/routes/contact.tsx` (3x),
  `src/routes/privacy-policy.tsx` (4x), `src/routes/terms-of-use.tsx` (5x),
  `src/lib/help-message.ts` (1x)

- [ ] **Step 1: super-admin/index.tsx (2x)**

`Ringkasan kondisi operasional Table Talker.` → `Ringkasan kondisi operasional LIME.`

- [ ] **Step 2: Footer.tsx**

`© {new Date().getFullYear()} Table Talker` → `© {new Date().getFullYear()} LIME`

- [ ] **Step 3: index.tsx (landing meta)**

`title: "Table Talker - Panggilan Meja"` → `title: "LIME - Panggilan Meja"`
`og:title "Table Talker - Panggilan Meja"` → `og:title "LIME - Panggilan Meja"`

- [ ] **Step 4: Semua sebutan nama di about / faq / help / contact / privacy / terms**

Ganti setiap "Table Talker" → "LIME" (judul meta, og:title, heading, body).
Contoh: "Tentang Table Talker" → "Tentang LIME"; "Apa itu Table Talker?" → "Apa itu LIME?";
"Table Talker adalah ..." → "LIME adalah ...". Kalimat lain tidak diubah.

- [ ] **Step 5: help-message.ts**

`*LAPORAN KENDALA TABLE TALKER*` → `*LAPORAN KENDALA LIME*`

- [ ] **Step 6: Hapus asset lama**

```bash
git rm public/table-talker-logo.webp
```

---

### Task 4: HIJAU + gate

- [ ] **Step 1: Focused**

Run: `npm test -- tests/brand-rename.test.ts tests/help-page-source.test.ts tests/help-message.test.ts`
Expected: PASS semua.

- [ ] **Step 2: Gate penuh**

Run: `npm run verify` — Expected: exit 0.

- [ ] **Step 3: Review diff + commit + push**

```bash
git add -A
git commit -m "style: rename Table Talker brand to LIME across app"
git push origin main
```

- [ ] **Step 4: Verifikasi**

- `git rev-parse origin/main` == HEAD lokal.
- Vercel READY + alias domain + probe HTTP 200 + `<title>` live di `lihatmeja.com`.

---

## Self-review

1. Spec coverage: login/shell/publik/footer/meta/WA/logo lama semua ada task-nya; pengecualian (cookie, soundboard, Owner Console, nama resto) tidak disentuh. ✓
2. Placeholder scan: tidak ada TBD; semua string exact. ✓
3. Konsistensi: brand "LIME" seragam; test pengawas case-insensitive mencegah regresi. ✓
