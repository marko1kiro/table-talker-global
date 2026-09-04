# TailAdmin Auth Pages + Manager Footer Dark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle halaman login/register Manager + login global crew ke TailAdmin (input berikon dalam field, hemat tinggi), pindahkan logo global ke dalam kartu, hapus ikon hero, dan betulkan footer dashboard Manager untuk dark mode.

**Architecture:** Lapisan tampilan saja. Primitif baru `dashboard/auth.tsx` (`IconField`, `AuthShell`, `taIconInputClass`) dipakai ulang 3 halaman. Logika auth (loginManager/registerManager/claim session/PIN/step) tidak disentuh.

**Tech Stack:** React 19, TanStack Router, Tailwind v4, lucide-react, Vitest (source-assertion; TANPA testing-library/jsdom).

**Konvensi (WAJIB):**
- Named imports saja. Setelah edit: `npx prettier --write <file>`.
- Komponen/route → source-assertion (`readFileSync(new URL("../src/...", import.meta.url),"utf8")` + `toContain`).
- `npm run verify` exit 0 sebelum commit/push.

**Constraint tes lama yang HARUS tetap hijau:**
- `manager-auth-routes.test.ts`: string `ID Manager`,`Password`,`membuat ID MANAGER BARU`,`loginManager`,`navigate({ to: "/manager" })`,`writeManagerIdentity`; register: `Nama Lengkap`,`Kode Resto`,`Ketik Ulang`,`loginToRestaurant`,`looking`,`animate-spin`,`restoValid`,`CheckCircle2`,`showPassword`,`EyeOff`,`canSubmit`,`disabled={!canSubmit || busy}`,`tidak cocok`.
- `role-login-flow.test.ts`: `id="restaurant-code"`, TIDAK ada `type="password"`, semua import + pola logic (`loginToRestaurant({ data: { code } })`,`verifyRestaurantPin({`,`tenantToken: login.tenantToken, pin`,`setStep`,`CREW_ROLE_ORDER.map`,`type="datetime-local"`,`jakartaCheckedInAtToIso(checkedInAt)`,`normalizeCrewName(name)`,`claimRoleSession({`,`displayName: normalized.displayName`,`checkedInAt: iso`,`accessToken,`,`onSsContinue`,`crewSessionId: ""`,`onRoleContinue`,`const [name, setName] = useState("")`,`const [checkedInAt, setCheckedInAt] = useState("")`).
- `manager-entry-button.test.ts`: `MANAGER` + `to="/manager/login"`.

---

## File Structure

**Create:** `src/components/dashboard/auth.tsx`, `tests/auth-ui.test.ts`
**Modify:** `src/components/ManagerLayout.tsx`, `src/routes/manager/login.tsx`, `src/routes/manager/register.tsx`, `src/components/RoleLoginFlow.tsx`, `tests/manager-auth-routes.test.ts`, `tests/role-login-flow.test.ts`, `tests/manager-layout.test.ts`

---

## Task 1: Primitif auth (`IconField`, `AuthShell`)

**Files:**
- Create: `src/components/dashboard/auth.tsx`
- Test: `tests/auth-ui.test.ts`

- [ ] **Step 1: Tulis tes gagal** — buat `tests/auth-ui.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/auth.tsx", import.meta.url), "utf8");

describe("dashboard/auth primitives", () => {
  it("IconField renders a leading icon + label-less input with a trailing slot", () => {
    const s = src();
    expect(s).toContain("export function IconField");
    expect(s).toContain("aria-label");
    expect(s).toContain("pl-11");
    expect(s).toContain("trailing");
    expect(s).toContain("{...inputProps}");
  });
  it("AuthShell centers a TailAdmin card with a logo container", () => {
    const s = src();
    expect(s).toContain("export function AuthShell");
    expect(s).toContain("bg-brand-50");
    expect(s).toContain("shadow-theme-md");
    expect(s).toContain("font-outfit");
  });
  it("input base carries dark variants", () => {
    expect(src()).toContain("dark:bg-ta-gray-900");
  });
});
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/auth-ui.test.ts`
Expected: FAIL (file belum ada).

- [ ] **Step 3: Implementasi** — buat `src/components/dashboard/auth.tsx`:

```tsx
/* eslint-disable react-refresh/only-export-components */
import type { InputHTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Compact TailAdmin input: leading icon inside the field, no visible label row
// (accessibility via aria-label), optional trailing slot (e.g. show/hide eye).
export const taIconInputClass =
  "min-h-11 w-full rounded-lg border border-ta-gray-300 bg-white py-2.5 pl-11 pr-3.5 text-sm text-ta-gray-900 outline-none transition placeholder:text-ta-gray-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/12 dark:border-ta-gray-700 dark:bg-ta-gray-900 dark:text-ta-gray-100 dark:placeholder:text-ta-gray-500";

export function IconField({
  icon: Icon,
  trailing,
  className,
  ...inputProps
}: { icon: LucideIcon; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-ta-gray-400" />
      <input className={cn(taIconInputClass, trailing && "pr-12", className)} {...inputProps} />
      {trailing && (
        <div className="absolute inset-y-0 right-0 flex w-11 items-center justify-center">
          {trailing}
        </div>
      )}
    </div>
  );
}

export function AuthShell({
  logo,
  title,
  subtitle,
  children,
  footer,
}: {
  logo?: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-ta-gray-50 px-4 py-10 font-outfit text-ta-gray-900">
      <div className="w-full max-w-md rounded-2xl border border-ta-gray-200 bg-white p-8 shadow-theme-md">
        {logo && (
          <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-brand-50">
            {logo}
          </div>
        )}
        <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">{title}</h1>
        {subtitle && <p className="mt-1 text-center text-sm text-ta-gray-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
        {footer && <div className="mt-6 text-center text-sm">{footer}</div>}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/auth-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/dashboard/auth.tsx tests/auth-ui.test.ts
git commit -m "feat(auth): TailAdmin IconField + AuthShell primitives"
```

---

## Task 2: Footer dashboard Manager ikut dark mode

**Files:**
- Modify: `src/components/ManagerLayout.tsx`
- Test: `tests/manager-layout.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah blok ke `describe("ManagerLayout (TailAdmin)", ...)` di `tests/manager-layout.test.ts`:

```ts
  it("footer card follows dark mode", () => {
    const text = source();
    expect(text).toContain("dark:bg-ta-gray-800");
    expect(text).toContain("dark:border-ta-gray-700");
  });
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — di `src/components/ManagerLayout.tsx`, ganti kelas kartu footer:

```tsx
    <div className="rounded-xl border border-ta-gray-200 bg-white p-4 text-center dark:border-ta-gray-700 dark:bg-ta-gray-800">
```

dan baris "XDIRGA LABS":

```tsx
      <p className="text-[11px] font-bold uppercase tracking-wide text-ta-gray-400 dark:text-ta-gray-500">
        XDIRGA LABS
      </p>
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/manager-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ManagerLayout.tsx tests/manager-layout.test.ts
git commit -m "fix(manager): footer card follows dark mode"
```

---

## Task 3: Manager login — TailAdmin + show/hide + validasi

**Files:**
- Modify: `src/routes/manager/login.tsx`
- Test: `tests/manager-auth-routes.test.ts`

- [ ] **Step 1: Tulis tes gagal** — ganti blok `describe("manager login route", ...)` di `tests/manager-auth-routes.test.ts`:

```ts
describe("manager login route", () => {
  const text = () => read("../src/routes/manager/login.tsx");
  it("collects ID Manager + Password and links to register", () => {
    expect(text()).toContain("ID Manager");
    expect(text()).toContain("Password");
    expect(text()).toContain("membuat ID MANAGER BARU");
    expect(text()).toContain("loginManager");
  });
  it("redirects to the dashboard only after a successful login", () => {
    expect(text()).toContain('navigate({ to: "/manager" })');
    expect(text()).toContain("writeManagerIdentity");
  });
  it("uses TailAdmin auth primitives with a show/hide password toggle", () => {
    expect(text()).toContain("AuthShell");
    expect(text()).toContain("IconField");
    expect(text()).toContain("showPassword");
    expect(text()).toContain("EyeOff");
  });
  it("gates submit until both fields are filled", () => {
    expect(text()).toContain("canSubmit");
    expect(text()).toContain("disabled={!canSubmit || busy}");
  });
});
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: FAIL (belum AuthShell/IconField/showPassword/canSubmit).

- [ ] **Step 3: Implementasi** — ganti SELURUH ISI `src/routes/manager/login.tsx`:

```tsx
import { useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { Eye, EyeOff, Hash, Loader2, Lock } from "lucide-react";
import { AuthShell, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { loginManager } from "@/lib/manager-auth.server";
import { ensureAnonAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { browserManagerStorage, writeManagerIdentity } from "@/lib/manager-session-identity";

export const Route = createFileRoute("/manager/login")({
  head: () => ({
    meta: [{ title: "Login Manager - LIME" }, { name: "robots", content: "noindex" }],
  }),
  component: ManagerLoginPage,
});

function ManagerLoginPage() {
  const navigate = useNavigate();
  const [idManager, setIdManager] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const canSubmit = idManager.trim().length > 0 && password.length > 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const accessToken = await ensureAnonAccessToken(getSupabaseBrowserClient());
      if (!accessToken) {
        setError("Gagal memulai sesi. Coba lagi.");
        return;
      }
      const result = await loginManager({ data: { idManager, password } });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      writeManagerIdentity(browserManagerStorage(), {
        idManager: result.idManager,
        fullName: result.fullName,
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.restaurantDisplayName,
        restaurantCode: result.restaurantCode,
        managerToken: result.managerToken,
        accessToken,
      });
      void navigate({ to: "/manager" });
    } catch {
      setError("Login gagal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      logo={<img src="/lime-logo.webp" alt="LIME" className="h-9 w-auto" />}
      title="Login Manager"
      footer={
        <Link to="/manager/register" className="font-semibold text-brand-500 hover:underline">
          KLIK DISINI untuk membuat ID MANAGER BARU
        </Link>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <IconField
          icon={Hash}
          aria-label="ID Manager"
          placeholder="ID Manager"
          value={idManager}
          onChange={(e) => setIdManager(e.target.value)}
          autoComplete="username"
          autoFocus
          required
        />
        <IconField
          icon={Lock}
          aria-label="Password"
          placeholder="Password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          trailing={
            <button
              type="button"
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShowPassword((v) => !v)}
              className="text-ta-gray-400 transition hover:text-ta-gray-600"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          }
        />
        {error && (
          <p role="alert" className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={!canSubmit || busy} className={`${taPrimaryButtonClass} w-full`}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Memeriksa..." : "Login"}
        </button>
      </form>
    </AuthShell>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/login.tsx tests/manager-auth-routes.test.ts
git commit -m "feat(manager): TailAdmin login with show/hide password + validation"
```

---

## Task 4: Manager register — TailAdmin (logic tetap)

**Files:**
- Modify: `src/routes/manager/register.tsx`
- Test: `tests/manager-auth-routes.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah assert ke `describe("manager register route", ...)` di `tests/manager-auth-routes.test.ts`:

```ts
  it("uses TailAdmin auth primitives", () => {
    expect(text()).toContain("AuthShell");
    expect(text()).toContain("IconField");
    expect(text()).toContain("taPrimaryButtonClass");
  });
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: FAIL (belum AuthShell/IconField).

- [ ] **Step 3: Implementasi** — edit `src/routes/manager/register.tsx`:

3a. Ganti blok import (baris 1-6):

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { CheckCircle2, Eye, EyeOff, Hash, Loader2, Lock, Store, User } from "lucide-react";
import { AuthShell, IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
import { registerManager } from "@/lib/manager-auth.server";
import { loginToRestaurant } from "@/lib/restaurants.server";
```

3b. Ganti SELURUH blok `return (...)` (baris 107-228) — logic di atasnya (state,
debounce, `canSubmit`, `submit`) TETAP:

```tsx
  return (
    <AuthShell
      title="Buat ID MANAGER BARU"
      footer={
        <Link to="/manager/login" className="font-semibold text-brand-500 hover:underline">
          Kembali ke Login Manager
        </Link>
      }
    >
      <form className="space-y-3" onSubmit={submit}>
        <IconField
          icon={User}
          aria-label="Nama Lengkap"
          placeholder="Nama Lengkap"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          autoFocus
          required
        />
        <IconField
          icon={Hash}
          aria-label="ID Manager"
          placeholder="ID Manager"
          value={idManager}
          onChange={(e) => setIdManager(e.target.value)}
          required
        />
        <IconField
          icon={Store}
          aria-label="Kode Resto"
          placeholder="Kode Resto"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="organization"
          required
        />
        <div className="min-h-[1.25rem] text-sm">
          {looking ? (
            <p className="flex items-center gap-2 font-semibold text-ta-gray-500">
              <Loader2 className="size-4 animate-spin" /> Memeriksa kode resto...
            </p>
          ) : restoValid ? (
            <p className="flex items-center gap-1.5 font-semibold text-ta-success">
              {restoName} <CheckCircle2 className="size-4 shrink-0" />
            </p>
          ) : code.trim() ? (
            <p className="font-semibold text-ta-error">Kode Resto tidak ditemukan.</p>
          ) : null}
        </div>
        <IconField
          icon={Lock}
          aria-label="Password"
          placeholder="Password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          trailing={
            <button
              type="button"
              aria-label={showPassword ? "Sembunyikan password" : "Tampilkan password"}
              onClick={() => setShowPassword((v) => !v)}
              className="text-ta-gray-400 transition hover:text-ta-gray-600"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          }
        />
        {passwordWeak && (
          <p className="text-xs font-semibold text-ta-error">Password minimal 8 karakter.</p>
        )}
        <IconField
          icon={Lock}
          aria-label="Ketik Ulang Password"
          placeholder="Ketik Ulang Password"
          type={showPassword ? "text" : "password"}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
        />
        {confirmMismatch && (
          <p className="text-xs font-semibold text-ta-error">Ketik ulang password tidak cocok.</p>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className={`${taPrimaryButtonClass} w-full`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Menyimpan..." : "Submit"}
        </button>
      </form>
    </AuthShell>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: PASS (semua assert register tetap hijau: `Nama Lengkap`,`Kode Resto`,
`Ketik Ulang`,`loginToRestaurant`,`looking`,`animate-spin`,`restoValid`,
`CheckCircle2`,`showPassword`,`EyeOff`,`canSubmit`,`disabled={!canSubmit || busy}`,
`tidak cocok`).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/register.tsx tests/manager-auth-routes.test.ts
git commit -m "feat(manager): TailAdmin register (logic unchanged)"
```

---

## Task 5: Login global (RoleLoginFlow) — TailAdmin, presentasional saja

**Files:**
- Modify: `src/components/RoleLoginFlow.tsx`
- Test: `tests/role-login-flow.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah `describe` baru di AKHIR `tests/role-login-flow.test.ts`:

```ts
describe("RoleLoginFlow: TailAdmin restyle (presentational only)", () => {
  it("uses TailAdmin card + brand button + icon fields, logo inside card", () => {
    const text = source();
    expect(text).toContain("taPrimaryButtonClass");
    expect(text).toContain("IconField");
    expect(text).toContain("bg-brand-50");
    expect(text).toContain("shadow-theme-md");
  });
  it("renames the code heading and drops the helper copy + hero icon boxes", () => {
    const text = source();
    expect(text).toContain("Login Dulu");
    expect(text).not.toContain("Masuk ke Resto");
    expect(text).not.toContain("Masukkan Kode Resto yang diberikan admin.");
    expect(text).not.toContain("from-sky-500");
  });
});
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/role-login-flow.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi** — edit `src/components/RoleLoginFlow.tsx` (HANYA
bagian import + JSX; semua handler/logic di baris 94-260 TETAP):

3a. Import lucide (baris 5-18): tambah `Calendar`, `User`; tetap `Store`,
`KeyRound` (dipakai sebagai ikon field), `CheckCircle2`, `Loader2`, `Lock`,
`Unlock`, `ShieldCheck`, `Sparkles`, `UserCog`, `Volume2`, `Wallet`, `ArrowLeft`.
Ganti blok import jadi:

```tsx
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  KeyRound,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  Store,
  Unlock,
  User,
  UserCog,
  Volume2,
  Wallet,
} from "lucide-react";
```

3b. Hapus import `Input` (baris 19), ganti dengan primitif auth + ui:

```tsx
import { IconField } from "@/components/dashboard/auth";
import { taPrimaryButtonClass } from "@/components/dashboard/ui";
```

3c. Ganti pembuka `<main>` + blok logo luar + kartu (baris 263-287) — pindahkan
logo ke DALAM kartu, buang blok logo luar, ganti kelas ke TailAdmin:

```tsx
  return (
    <main className="relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden bg-ta-gray-50 px-4 py-10 font-outfit sm:px-6">
      <div className="relative w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2">
          {STEP_ORDER.map((s, i) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === stepIndex
                  ? "w-8 bg-brand-500"
                  : i < stepIndex
                    ? "w-4 bg-brand-300"
                    : "w-4 bg-ta-gray-200"
              }`}
            />
          ))}
        </div>

        <div className="rounded-2xl border border-ta-gray-200 bg-white p-6 shadow-theme-md sm:p-8">
          <div className="mb-6 flex flex-col items-center gap-2 text-center">
            <span className="grid size-16 place-items-center rounded-2xl bg-brand-50">
              <img src="/lime-logo.webp" alt="LIME" className="h-9 w-auto select-none" />
            </span>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-ta-gray-400">
              Login Crew
            </p>
          </div>
```

3d. Step `code` (baris 288-340): buang kotak hero `Store`, ganti judul + hapus
paragraf helper, ganti `Input`→`IconField`, tombol→`taPrimaryButtonClass`, kotak
"Login MANAGER"→brand:

```tsx
          {step === "code" && (
            <>
              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                Login Dulu
              </h1>
              <div className="mt-5 mb-1 rounded-xl border border-ta-gray-200 bg-ta-gray-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-ta-gray-500">
                  Khusus Pimpinan Shift
                </p>
                <Link
                  to="/manager/login"
                  className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-brand-600"
                >
                  <UserCog className="size-4" /> Login MANAGER
                </Link>
              </div>
              <form className="mt-6 space-y-4" onSubmit={submitCode}>
                <IconField
                  icon={Store}
                  id="restaurant-code"
                  aria-label="Kode Resto"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Masukkan Kode Resto"
                  autoComplete="organization"
                  required
                  autoFocus
                />
                {codeError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
                  >
                    {codeError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submittingCode}
                  className={`${taPrimaryButtonClass} w-full`}
                >
                  {submittingCode && <Loader2 className="size-4 animate-spin" />}
                  {submittingCode ? "Memeriksa..." : "Lanjutkan"}
                </button>
              </form>
            </>
          )}
```

3e. Step `pin` (baris 342-400): buang hero `KeyRound`, badge resto→brand,
`Input`→`IconField` (icon `KeyRound`), tombol→brand. Jaga `id="restaurant-pin"`,
`onlyDigits`, `maxLength`, `inputMode`, `disabled={submittingPin || pin.length !== 4}`:

```tsx
          {step === "pin" && login && (
            <>
              <button
                type="button"
                onClick={backToCode}
                className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600"
              >
                <ArrowLeft className="size-3.5" /> Ganti Kode Resto
              </button>

              <div className="mb-5 flex justify-center">
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span className="truncate">{login.displayName}</span>
                </span>
              </div>

              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                ID Resto
              </h1>
              <form className="mt-6 space-y-4" onSubmit={submitPin}>
                <IconField
                  icon={KeyRound}
                  id="restaurant-pin"
                  aria-label="ID Resto"
                  value={pin}
                  onChange={(event) => setPin(onlyDigits(event.target.value, 4))}
                  placeholder="0000"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  required
                  autoFocus
                  className="text-center text-lg font-black tracking-[0.4em]"
                />
                {pinError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
                  >
                    {pinError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submittingPin || pin.length !== 4}
                  className={`${taPrimaryButtonClass} w-full`}
                >
                  {submittingPin && <Loader2 className="size-4 animate-spin" />}
                  {submittingPin ? "Memeriksa..." : "Lanjutkan"}
                </button>
              </form>
            </>
          )}
```

3f. Step `role` (baris 402-452): badge resto→brand, judul tetap "Pilih Station",
ikon per-role container gradient→brand (ikon TETAP):

```tsx
          {step === "role" && login && (
            <>
              <button
                type="button"
                onClick={backToPin}
                className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600"
              >
                <ArrowLeft className="size-3.5" /> Ganti ID Resto
              </button>

              <div className="mb-5 flex justify-center">
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span className="truncate">{login.displayName}</span>
                </span>
              </div>

              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                Pilih Station
              </h1>
              <p className="mt-1 text-center text-sm text-ta-gray-500">
                Pilih station kamu untuk melanjutkan.
              </p>

              <div className="mt-6 flex flex-col gap-3">
                {CREW_ROLE_ORDER.map((option) => {
                  const meta = ROLE_META[option];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => {
                        setRole(option);
                        setStep("identity");
                      }}
                      className="group flex w-full items-center gap-3 rounded-xl border border-ta-gray-200 bg-white px-4 py-3.5 text-left shadow-theme-xs transition hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
                        <Icon className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-bold text-ta-gray-900">
                          {CREW_ROLE_LABELS[option]}
                        </span>
                        <span className="block truncate text-xs text-ta-gray-500">
                          {meta.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
```

3g. Step `identity` (baris 454-535): badge→brand, `Input`→`IconField` (nama icon
`User`, datetime icon `Calendar`), tombol→brand. Jaga `id="crew-name"`,
`id="checked-in-at"`, `type="datetime-local"`, `canSubmitIdentity`, pola tombol
`Lock`/`Unlock`:

```tsx
          {step === "identity" && role && login && (
            <>
              <button
                type="button"
                onClick={backToRole}
                className="mb-4 inline-flex items-center gap-1 text-xs font-bold text-ta-gray-400 transition hover:text-ta-gray-600"
              >
                <ArrowLeft className="size-3.5" /> Ganti Station
              </button>

              <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                  {CREW_ROLE_LABELS[role]}
                </span>
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
                  {login.displayName}
                </span>
              </div>

              <h1 className="text-center text-2xl font-bold tracking-tight text-ta-gray-900">
                Lengkapi Data
              </h1>
              <p className="mt-1 text-center text-sm text-ta-gray-500">
                Isi nama dan jam kerja kamu sebagai {CREW_ROLE_LABELS[role]}.
              </p>

              <form className="mt-6 space-y-4" onSubmit={submitIdentity}>
                <IconField
                  icon={User}
                  id="crew-name"
                  aria-label="Nama"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Nama kamu"
                  required
                  autoFocus
                />
                <IconField
                  icon={Calendar}
                  id="checked-in-at"
                  aria-label="Tanggal & Jam Kerja"
                  type="datetime-local"
                  value={checkedInAt}
                  onChange={(event) => setCheckedInAt(event.target.value)}
                  required
                />
                {identityError && (
                  <div
                    role="alert"
                    className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
                  >
                    {identityError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={!canSubmitIdentity || submittingIdentity}
                  className={
                    canSubmitIdentity
                      ? `${taPrimaryButtonClass} w-full`
                      : "flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-ta-gray-100 text-sm font-semibold text-ta-gray-400"
                  }
                >
                  {submittingIdentity ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Memproses...
                    </>
                  ) : canSubmitIdentity ? (
                    <>
                      <Unlock className="size-4" /> Masuk
                    </>
                  ) : (
                    <>
                      <Lock className="size-4" /> Lengkapi Data
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-5 text-ta-gray-400">
          Aktivitas login dapat dicatat untuk keamanan operasional.
        </p>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU (baru + semua assert lama)**

Run: `npx vitest run tests/role-login-flow.test.ts tests/manager-entry-button.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add src/components/RoleLoginFlow.tsx tests/role-login-flow.test.ts
git commit -m "feat(auth): TailAdmin global login; logo in card; drop hero icons; Login Dulu"
```

---

## Task 6: Full quality gate + preview

- [ ] **Step 1: Format**

Run: `npx prettier --write "src/**/*.{ts,tsx}" "tests/**/*.ts"`

- [ ] **Step 2: Full gate**

Run: `npm run verify`
Expected: exit 0 (test + typecheck + lint + build). Bila lint komplain unused
import (mis. `Input` sisa), hapus import-nya.

- [ ] **Step 3: Regresi auth**

Run: `npx vitest run tests/manager-auth-routes.test.ts tests/role-login-flow.test.ts tests/manager-entry-button.test.ts tests/restaurant-login-build.test.ts tests/auth-ui.test.ts`
Expected: PASS.

- [ ] **Step 4: Push branch (refresh preview) — hanya dengan izin user**

Run: `git push origin feat/tailadmin-theme` lalu `vercel ls lihat-meja --scope gacoan1` sampai `● Ready`.

---

## Self-Review

**Spec coverage:** primitif auth (T1), footer dark (T2), manager login show/hide +
validasi + TailAdmin (T3), register TailAdmin logic-tetap (T4), global login
TailAdmin + logo dlm kartu + hapus hero + "Login Dulu" + hapus teks (T5), gate
(T6). Semua tertutup.

**Placeholder scan:** tak ada TBD; tiap langkah punya kode/perintah.

**Konsistensi tipe/nama:** `IconField`/`AuthShell`/`taIconInputClass` (T1) dipakai
identik di T3/T4/T5. `taPrimaryButtonClass` dari `dashboard/ui` (sudah ada).
`id` field global (`restaurant-code`,`restaurant-pin`,`crew-name`,`checked-in-at`)
dipertahankan → `role-login-flow.test.ts` hijau. `Store`/`KeyRound` tetap diimport
(dipakai `icon={...}`), `Calendar`/`User` ditambah.
