# Auth Split Layout (TailAdmin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bungkus login global + login manager + register manager dalam layout split-screen TailAdmin (kolom form + panel branding), responsif semua ukuran, field & logic tetap.

**Architecture:** Komponen baru `AuthLayout` di `dashboard/auth.tsx` (split: form `flex-1` + panel `hidden lg:flex lg:w-1/2 bg-brand-950` dengan grid + logo + tagline). 3 halaman auth pakai `AuthLayout`; konten form (IconField + logic) tidak berubah. Di login global, slot "Sign in with Google" demo jadi tombol "Login Manager" (gaya sekunder), tanpa tombol X, + divider "Or".

**Tech Stack:** React 19, TanStack Router, Tailwind v4, lucide-react, Vitest (source-assertion; tanpa jsdom).

**Konvensi:** named imports; `npx prettier --write <file>` setelah edit; `npm run verify` exit 0 sebelum commit/push.

**Constraint tes lama yang wajib tetap hijau:** lihat spec (manager-auth-routes + role-login-flow + manager-entry-button).

---

## Task 1: Token brand-950 + aset grid + `AuthLayout`

**Files:**
- Modify: `src/styles.css` (@theme)
- Create: `public/shape/grid-01.svg`
- Modify: `src/components/dashboard/auth.tsx` (tambah `AuthLayout`)
- Test: `tests/auth-ui.test.ts`

- [ ] **Step 1: Tulis tes gagal** — tambah ke `tests/auth-ui.test.ts`:

```ts
import { existsSync } from "node:fs";

describe("AuthLayout (TailAdmin split)", () => {
  it("splits form + branding panel, responsive", () => {
    const s = src();
    expect(s).toContain("export function AuthLayout");
    expect(s).toContain("lg:flex-row");
    expect(s).toContain("lg:w-1/2");
    expect(s).toContain("bg-brand-950");
    expect(s).toContain("grid-01.svg");
    expect(s).toContain("lime-logo.webp");
  });
  it("adds brand-950 token and grid asset", () => {
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    expect(css).toContain("--color-brand-950:");
    expect(existsSync(new URL("../public/shape/grid-01.svg", import.meta.url))).toBe(true);
  });
});
```

> Tambah `import { readFileSync } from "node:fs";` di atas file bila belum ada helper `src()` menunjuk `auth.tsx` (sudah ada dari task auth sebelumnya).

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/auth-ui.test.ts`
Expected: FAIL (AuthLayout/brand-950/grid belum ada).

- [ ] **Step 3a: Tambah token** — di `src/styles.css` blok `@theme inline`, setelah `--color-brand-700: #2a31d8;` tambah:

```css
  --color-brand-950: #10133a;
```

- [ ] **Step 3b: Aset grid** — buat `public/shape/grid-01.svg` berisi SVG grid TailAdmin (sama persis dengan aset yang dipakai halaman coming-soon: `<svg width="450" height="254" ...>` dengan garis `#B2B2B2` opacity 0.3 + 2 rect `#B2B2B2` opacity 0.08).

- [ ] **Step 3c: Komponen** — tambah ke `src/components/dashboard/auth.tsx`:

```tsx
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative z-10 flex min-h-[100svh] w-full flex-col bg-white lg:flex-row dark:bg-ta-gray-900">
      <div className="flex flex-1 flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-md">{children}</div>
      </div>
      <div className="relative hidden w-full items-center justify-center overflow-hidden bg-brand-950 lg:flex lg:w-1/2 dark:bg-white/5">
        <img
          src="/shape/grid-01.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 w-[250px] xl:w-[450px]"
        />
        <img
          src="/shape/grid-01.svg"
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 w-[250px] rotate-180 xl:w-[450px]"
        />
        <div className="relative z-10 flex max-w-xs flex-col items-center">
          <span className="mb-4 grid place-items-center rounded-2xl bg-white px-5 py-3">
            <img src="/lime-logo.webp" alt="LIME" className="h-10 w-auto" />
          </span>
          <p className="text-center text-sm text-ta-gray-400">
            Sistem Panggilan &amp; Status Meja Restoran
          </p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/auth-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/styles.css public/shape/grid-01.svg src/components/dashboard/auth.tsx tests/auth-ui.test.ts
git commit -m "feat(auth): AuthLayout split (form + branding panel) + brand-950 + grid asset"
```

---

## Task 2: Login manager → AuthLayout

**Files:**
- Modify: `src/routes/manager/login.tsx`
- Test: `tests/manager-auth-routes.test.ts`

- [ ] **Step 1: Tulis tes gagal** — di `tests/manager-auth-routes.test.ts`, ganti assert `AuthShell` → `AuthLayout` pada blok login:

```ts
  it("uses TailAdmin auth primitives with a show/hide password toggle", () => {
    expect(text()).toContain("AuthLayout");
    expect(text()).toContain("IconField");
    expect(text()).toContain("showPassword");
    expect(text()).toContain("EyeOff");
  });
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: FAIL (belum AuthLayout).

- [ ] **Step 3: Implementasi** — edit `src/routes/manager/login.tsx`:

3a. Ganti import primitif auth:

```tsx
import { AuthLayout, IconField } from "@/components/dashboard/auth";
```

3b. Ganti SELURUH blok `return (...)`:

```tsx
  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Login Manager
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Masukkan ID Manager dan password untuk masuk ke dashboard.
        </p>
      </div>
      <form className="space-y-5" onSubmit={submit}>
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
          <p
            role="alert"
            className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit || busy}
          className={`${taPrimaryButtonClass} w-full`}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Memeriksa..." : "Login"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-ta-gray-500 dark:text-ta-gray-400">
        <Link to="/manager/register" className="font-semibold text-brand-500 hover:underline">
          KLIK DISINI untuk membuat ID MANAGER BARU
        </Link>
      </p>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: PASS (login).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/login.tsx tests/manager-auth-routes.test.ts
git commit -m "feat(manager): login page uses TailAdmin AuthLayout split"
```

---

## Task 3: Register manager → AuthLayout

**Files:**
- Modify: `src/routes/manager/register.tsx`
- Test: `tests/manager-auth-routes.test.ts`

- [ ] **Step 1: Tulis tes gagal** — di `tests/manager-auth-routes.test.ts`, ganti assert register:

```ts
  it("uses TailAdmin auth primitives", () => {
    expect(text()).toContain("AuthLayout");
    expect(text()).toContain("IconField");
    expect(text()).toContain("taPrimaryButtonClass");
  });
```

- [ ] **Step 2: Jalankan → MERAH**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: FAIL (belum AuthLayout).

- [ ] **Step 3: Implementasi** — edit `src/routes/manager/register.tsx`:

3a. Ganti import primitif auth:

```tsx
import { AuthLayout, IconField } from "@/components/dashboard/auth";
```

3b. Ganti SELURUH blok `return (...)` (logic di atasnya TETAP):

```tsx
  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
          Buat ID MANAGER BARU
        </h1>
        <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
          Daftarkan manager untuk restoran kamu.
        </p>
      </div>
      <form className="space-y-4" onSubmit={submit}>
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
          <p
            role="alert"
            className="rounded-lg bg-ta-error/10 px-4 py-3 text-sm font-semibold text-ta-error"
          >
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
      <p className="mt-6 text-center text-sm text-ta-gray-500 dark:text-ta-gray-400">
        <Link to="/manager/login" className="font-semibold text-brand-500 hover:underline">
          Kembali ke Login Manager
        </Link>
      </p>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU**

Run: `npx vitest run tests/manager-auth-routes.test.ts`
Expected: PASS (semua assert register tetap hijau).

- [ ] **Step 5: Commit**

```bash
git add src/routes/manager/register.tsx tests/manager-auth-routes.test.ts
git commit -m "feat(manager): register page uses TailAdmin AuthLayout split"
```

---

## Task 4: Login global (RoleLoginFlow) → AuthLayout + tombol Login Manager

**Files:**
- Modify: `src/components/RoleLoginFlow.tsx`
- Test: `tests/role-login-flow.test.ts`

- [ ] **Step 1: Tulis tes gagal** — ganti `describe("RoleLoginFlow: TailAdmin restyle ...")` di `tests/role-login-flow.test.ts` jadi:

```ts
describe("RoleLoginFlow: TailAdmin split layout", () => {
  it("uses AuthLayout + brand button + icon fields", () => {
    const text = source();
    expect(text).toContain("AuthLayout");
    expect(text).toContain("taPrimaryButtonClass");
    expect(text).toContain("IconField");
  });
  it("manager entry is a demo-style secondary button, no X button, with Or divider", () => {
    const text = source();
    expect(text).toContain("Login Manager");
    expect(text).toContain("bg-ta-gray-100");
    expect(text).toContain(">Or<");
    expect(text).not.toContain("Sign in with X");
    expect(text).not.toContain("Khusus Pimpinan Shift");
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

- [ ] **Step 3: Implementasi** — edit `src/components/RoleLoginFlow.tsx` (HANYA import +
`return`; handler/logic baris 94-260 TETAP):

3a. Tambah import `AuthLayout` (gabung ke baris import auth):

```tsx
import { AuthLayout, IconField } from "@/components/dashboard/auth";
```

3b. Ganti SELURUH blok `return (...)` (dari `  return (` sampai penutup `  );\n}`)
dengan versi AuthLayout berikut — konten wizard pindah ke kolom form, kartu + blok
logo diilangin (logo sekarang di panel `AuthLayout`), step `code` pakai tombol
"Login Manager" gaya sekunder + divider "Or":

```tsx
  return (
    <AuthLayout>
      <div className="mb-5 flex items-center justify-center gap-2">
        {STEP_ORDER.map((s, i) => (
          <span
            key={s}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === stepIndex ? "w-8 bg-brand-500" : i < stepIndex ? "w-4 bg-brand-300" : "w-4 bg-ta-gray-200"
            }`}
          />
        ))}
      </div>

      {step === "code" && (
        <>
          <div className="mb-6">
            <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
              Login Dulu
            </h1>
            <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
              Masuk ke station kamu untuk mulai bertugas.
            </p>
          </div>
          <Link
            to="/manager/login"
            className="inline-flex w-full items-center justify-center gap-3 rounded-lg bg-ta-gray-100 px-7 py-3 text-sm font-medium text-ta-gray-700 transition hover:bg-ta-gray-200 dark:bg-white/5 dark:text-white/90 dark:hover:bg-white/10"
          >
            <UserCog className="size-5" /> Login Manager
          </Link>
          <div className="relative py-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-ta-gray-200 dark:border-ta-gray-700" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-white px-3 text-ta-gray-400 dark:bg-ta-gray-900">Or</span>
            </div>
          </div>
          <form className="space-y-4" onSubmit={submitCode}>
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
            <button type="submit" disabled={submittingCode} className={`${taPrimaryButtonClass} w-full`}>
              {submittingCode && <Loader2 className="size-4 animate-spin" />}
              {submittingCode ? "Memeriksa..." : "Lanjutkan"}
            </button>
          </form>
        </>
      )}

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
          <div className="mb-6">
            <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">ID Resto</h1>
            <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
              Masukkan ID Resto (4 digit) yang diberikan admin untuk resto ini.
            </p>
          </div>
          <form className="space-y-4" onSubmit={submitPin}>
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
          <div className="mb-6">
            <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
              Pilih Station
            </h1>
            <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
              Pilih station kamu untuk melanjutkan.
            </p>
          </div>
          <div className="flex flex-col gap-3">
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
                  className="group flex w-full items-center gap-3 rounded-xl border border-ta-gray-200 bg-white px-4 py-3.5 text-left shadow-theme-xs transition hover:border-brand-300 hover:bg-brand-50/40 dark:border-ta-gray-700 dark:bg-ta-gray-800"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white">
                    <Icon className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-ta-gray-900 dark:text-white">
                      {CREW_ROLE_LABELS[option]}
                    </span>
                    <span className="block truncate text-xs text-ta-gray-500 dark:text-ta-gray-400">
                      {meta.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

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
          <div className="mb-6">
            <h1 className="mb-2 text-2xl font-semibold text-ta-gray-800 dark:text-white">
              Lengkapi Data
            </h1>
            <p className="text-sm text-ta-gray-500 dark:text-ta-gray-400">
              Isi nama dan jam kerja kamu sebagai {CREW_ROLE_LABELS[role]}.
            </p>
          </div>
          <form className="space-y-4" onSubmit={submitIdentity}>
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

      <p className="mt-6 text-center text-xs leading-5 text-ta-gray-400">
        Aktivitas login dapat dicatat untuk keamanan operasional.
      </p>
    </AuthLayout>
  );
}
```

- [ ] **Step 4: Jalankan → HIJAU (baru + semua assert lama)**

Run: `npx vitest run tests/role-login-flow.test.ts tests/manager-entry-button.test.ts`
Expected: PASS semua.

- [ ] **Step 5: Commit**

```bash
git add src/components/RoleLoginFlow.tsx tests/role-login-flow.test.ts
git commit -m "feat(auth): global login uses AuthLayout split; Login Manager button (demo style)"
```

---

## Task 5: Full quality gate + preview

- [ ] **Step 1: Format** — `npx prettier --write "src/**/*.{ts,tsx,css}" "tests/**/*.ts"`
- [ ] **Step 2: Full gate** — `npm run verify` → exit 0. Bila lint komplain unused import
    (mis. `AuthShell`/`Store`/`KeyRound` sisa), hapus.
- [ ] **Step 3: Regresi auth** — `npx vitest run tests/manager-auth-routes.test.ts tests/role-login-flow.test.ts tests/manager-entry-button.test.ts tests/auth-ui.test.ts tests/restaurant-login-build.test.ts` → PASS.
- [ ] **Step 4: Push branch (dengan izin)** — `git push -u origin feat/auth-split-layout` → cek preview Ready.

---

## Self-Review

**Spec coverage:** AuthLayout split responsif (T1), brand-950 + grid (T1), login manager (T2), register manager (T3), login global + tombol Login Manager + Or + tanpa X (T4), gate (T5).

**Placeholder scan:** tak ada TBD; tiap langkah punya kode/perintah. Aset grid = salinan konten SVG TailAdmin (identik coming-soon).

**Konsistensi:** `AuthLayout` (T1) dipakai identik T2/T3/T4. `IconField`/`taPrimaryButtonClass` tetap. `id="restaurant-code"`/`restaurant-pin`/`crew-name`/`checked-in-at` + `type="datetime-local"` dipertahankan → tes logic lama hijau. `UserCog`/`Store`/`KeyRound`/`Calendar`/`User` tetap diimport (dipakai).
