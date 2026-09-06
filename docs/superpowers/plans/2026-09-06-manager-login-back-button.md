# Manager Login Back Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah tombol ghost "Kembali" (link ke `/`) di halaman `/manager/login`.

**Architecture:** Satu file route diubah (`src/routes/manager/login.tsx`). Tombol = TanStack `Link` statis ke home dengan ikon `ArrowLeft`, ditaruh di atas blok heading kolom form. Test = source assertion (pola yang sudah dipakai repo ini, tanpa jsdom).

**Tech Stack:** TanStack Router (`Link`), lucide-react (`ArrowLeft`), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-manager-login-back-button-design.md`

---

### Task 1: Tombol Kembali di Login Manager

**Files:**
- Create: `tests/manager-login-back.test.ts`
- Modify: `src/routes/manager/login.tsx`

- [ ] **Step 1: Tulis test gagal (MERAH)**

Buat `tests/manager-login-back.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loginSource = readFileSync(
  new URL("../src/routes/manager/login.tsx", import.meta.url),
  "utf8",
);

describe("Manager login back button", () => {
  it("menyediakan link Kembali ke home", () => {
    expect(loginSource).toContain('to="/"');
    expect(loginSource).toContain("Kembali");
    expect(loginSource).toContain("ArrowLeft");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `npx vitest run tests/manager-login-back.test.ts`
Expected: FAIL — `"Kembali"` belum ada di `login.tsx`.

- [ ] **Step 3: Implementasi minimal**

Di `src/routes/manager/login.tsx`:

1. Tambah `ArrowLeft` ke import lucide:

```tsx
import { ArrowLeft, Eye, EyeOff, Hash, Loader2, Lock } from "lucide-react";
```

2. Sisipkan link Kembali sebagai anak pertama `<AuthLayout>` (sebelum `<div className="mb-8">`):

```tsx
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-ta-gray-500 transition hover:text-brand-500 dark:text-ta-gray-400 dark:hover:text-brand-400"
      >
        <ArrowLeft className="size-4" />
        Kembali
      </Link>
```

- [ ] **Step 4: Prettier + jalankan test, pastikan hijau**

Run: `npx prettier --write src/routes/manager/login.tsx tests/manager-login-back.test.ts`
Run: `npx vitest run tests/manager-login-back.test.ts`
Expected: PASS (1 passed).

- [ ] **Step 5: Gate penuh + commit**

Run: `npm run verify`
Expected: exit 0.

```bash
git add src/routes/manager/login.tsx tests/manager-login-back.test.ts
git commit -m "feat(manager): tombol Kembali ke home di halaman login"
```
