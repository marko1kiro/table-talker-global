# Poin 6.1 — Login Password Crew + Update Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ganti login rutin crew dari magic-link/OTP menjadi email + password (email-first, mesin penentu jalur), OTP hanya untuk daftar/setup pertama/reset password dengan gate wajib "Buat Password", plus Update Prompt wajib-konfirmasi untuk semua role.

**Architecture:** Satu RPC baru `crew_auth_method` + quota `reserve_crew_auth_method` (additive, service_role-only) dipanggil server fn anonim `crewLoginMethod`; `CrewLoginFlow` jadi state machine email-first dengan step `password`/`setPassword` baru (password disimpan browser-direct via `auth.updateUser`, nol sentuhan sesi perangkat lain); modul `update-prompt.ts` mendeteksi bundle baru dengan membandingkan nama aset `index-*.js` pada HTML live vs yang sedang jalan (tanpa version.json, tanpa vite define) dan menampilkan modal Refresh/Nanti Aja yang dipasang di `__root.tsx` (meng covering semua role sekaligus).

**Tech Stack:** TanStack Start (server fn), supabase-js, Vitest + Testing Library (jsdom), embedded-postgres DB harness (`tests/db/harness.ts` + `tests/db/supabase-shim.sql`), sonner (Toaster), lucide-react, Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-15-poin-6-1-crew-password-design.md` (main `d096730`).

**Deviasi sadar dari spec (lapor jujur, disetujui dalam plan-review oleh leader — bos diberitahu saat handoff):**

1. **§5.1–5.2 Update Prompt tanpa `version.json` + `__APP_BUILD_ID__`:** probe membandingkan nama file `/assets/index-<hash>.js` yang tercantum di HTML live (fetch `/?t=` no-store) dengan `<script src>` milik halaman yang sedang jalan. Satu sumber kebenaran (nama bundel itu sendiri), nol perubahan `vite.config.ts`, dev otomatis diam (tidak ada script hashed). Perilaku akhir identik dengan spec.
2. **§3.1 throttle:** TIDAK memakai `lookup_rate_limits` existing (semantiknya "5 kegagalan" dan dipakai fitur lain lewat komentar atasnya; 5/15mnt akan mengunci 1 resto lewat NAT saat pergantian shift). Ditambah tabel + fungsi KUOTA baru `crew_auth_method_limits` / `reserve_crew_auth_method` (50 lookup/15 menit/IP-hash, blokir 15 menit) — tetap additive, tetap pola `SECURITY DEFINER` service_role-only.
3. **§7 ekstraksi "mesin penuh" dipersempit** jadi logika routing murni yang bisa dites lewat komponen jsdom (pola `point-3-crew-login-flow.test.tsx` sudah membuktikan komponen utuh bisa dites end-to-end): reducer terpisah = rewrite 855 baris berisiko di minggu trial tanpa nilai tambah uji. Transisi dites lewat test komponen; guard busy & field-kosong dites di komponen. Kalau setelah field test masih terasa butuh reducer murni, itu jalur upgrade Poin berikutnya.

**Aturan kerja (mengikat semua task):**

- TDD ketat: tulis test, JALANKAN dan LIHAT GAGAL dengan alasan yang benar, baru implementasi.
- Shell PowerShell setiap sesi: `$env:Path = 'C:\Users\dirga\AppData\Local\Temp\opencode\node-v22.20.0-win-x64;' + $env:Path`
- Verifikasi lokal TERTARGET saja (DILARANG `npm run verify` / `vitest` penuh / `eslint .` — gate resmi = CI): `npx vitest run <file>`, `npm run typecheck` (±1 menit), `npx eslint <file...>`.
- Commit tiap task di branch `poin-6-1`. JANGAN push/dan jangan buat PR sebelum Task 7 (perintah pemilik: docs/pekerjaan jalan jangan langsung di-push; push hanya untuk rilis lewat PR + CI).
- Secret/PAT/password JANGAN pernah dicetak. Aset AGENTS §2 tidak disentuh (plan ini nol drop).
- Pesan error/copy UI memakai teks persis di plan (koreksi typo hanya lewat persetujuan leader di review).

**File map (siapa menyentuh apa):**

- Create: `supabase/migrations/20260915120000_crew_auth_method.sql`, `tests/db/point-6-1-crew-auth-method.test.ts`, `tests/point-6-1-crew-login-method.test.ts`, `tests/point-6-1-browser-auth.test.ts`, `tests/point-6-1-crew-login-flow.test.tsx`, `tests/point-6-1-update-prompt.test.tsx`, `tests/point-6-1-build-guards.test.ts`, `src/lib/update-prompt.ts`, `src/components/UpdatePrompt.tsx`
- Modify: `src/lib/crew-auth.server.ts` (tambah `crewLoginMethodCore` + server fn), `src/lib/browser-auth.ts` (tambah `crewSignInWithPassword`, `crewSetPassword`), `src/components/CrewLoginFlow.tsx` (rewrite state machine + layar baru), `src/routes/__root.tsx` (mount `<Toaster/>` + `<UpdatePrompt/>`), `tests/point-3-crew-login-flow.test.tsx` (adaptasi jalur OTP lama → kini ada step `setPassword`)

---

### Task 1: DB — RPC `crew_auth_method` + quota `reserve_crew_auth_method`

**Files:**
- Create: `supabase/migrations/20260915120000_crew_auth_method.sql`
- Test: `tests/db/point-6-1-crew-auth-method.test.ts`

- [ ] **Step 1.1: Tulis test DB yang gagal**

`tests/db/point-6-1-crew-auth-method.test.ts` — replays the FULL chain (harness), so tests assert the NEW objects exist and behave; nothing is dropped:

```ts
// Poin 6.1 S1: crew_auth_method verdicts + burst quota. Additive migration:
// must not remove or alter any protected asset object.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, stopAll, type TestDb } from "./harness";

let db: TestDb;
let c: Client;

beforeAll(async () => {
  db = await createTestDb("lime_p61_crew_auth_method");
  c = await db.client();
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

async function verdict(email: string): Promise<string> {
  const r = await c.query("select public.crew_auth_method($1) as v", [email]);
  return r.rows[0].v;
}

describe("crew_auth_method verdicts", () => {
  test("unknown email is otp (enumeration stays blurry)", async () => {
    expect(await verdict("tidakada@example.test")).toBe("otp");
  });

  test("user without password is otp; with password is password", async () => {
    await c.query(
      `insert into auth.users (email, encrypted_password) values
        ('lama@ex.test', ''), ('baru@ex.test', null), ('pakai@ex.test', 'xscrypt$abc')`,
    );
    expect(await verdict("lama@ex.test")).toBe("otp");
    expect(await verdict("baru@ex.test")).toBe("otp");
    expect(await verdict("pakai@ex.test")).toBe("password");
  });

  test("verdict ignores case and surrounding spaces", async () => {
    await c.query(`insert into auth.users (email, encrypted_password) values ('Trim@Ex.TEST', 'p')`);
    expect(await verdict("  trim@ex.test  ")).toBe("password");
    expect(await verdict("TRIM@EX.TEST")).toBe("password");
  });
});

describe("reserve_crew_auth_method quota", () => {
  test("allows 50 calls per 15-minute window per bucket, then blocks", async () => {
    const bucket = "t".repeat(64);
    let allowed = 0;
    for (let i = 0; i < 52; i += 1) {
      const r = await c.query("select public.reserve_crew_auth_method($1) as ok", [bucket]);
      if (r.rows[0].ok) allowed += 1;
    }
    expect(allowed).toBe(50);
  });

  test("buckets are independent per ip_hash", async () => {
    const a = "a".repeat(64);
    const b = "b".repeat(64);
    for (let i = 0; i < 52; i += 1) {
      await c.query("select public.reserve_crew_auth_method($1)", [a]);
    }
    const r = await c.query("select public.reserve_crew_auth_method($1) as ok", [b]);
    expect(r.rows[0].ok).toBe(true);
  });
});

describe("grants and shape", () => {
  test("both functions are SECURITY DEFINER with pinned search_path", async () => {
    const r = await c.query(
      `select p.proname, p.prosecdef,
              coalesce(nullif(array_to_string(p.proconfig, ','), ''), '(none)') as cfg
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('crew_auth_method', 'reserve_crew_auth_method')`,
    );
    expect(r.rows).toHaveLength(2);
    for (const row of r.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.cfg).toContain("search_path=public");
    }
  });

  test("anon and authenticated cannot execute; service_role can", async () => {
    for (const role of ["anon", "authenticated"]) {
      await c.query(`set role ${role}`);
      await expect(
        c.query("select public.crew_auth_method('x@ex.test')"),
      ).rejects.toThrow(/permission denied/i);
      await c.query("reset role");
    }
    await c.query("set role service_role");
    const r = await c.query("select public.crew_auth_method('x@ex.test') as v");
    expect(["otp", "password"]).toContain(r.rows[0].v);
    await c.query("reset role");
  });

  test("quota table is not readable by anon/authenticated", async () => {
    await c.query("set role anon");
    await expect(
      c.query("select 1 from public.crew_auth_method_limits"),
    ).rejects.toThrow(/permission denied/i);
    await c.query("reset role");
  });
});

describe("nothing is dropped (additive migration)", () => {
  test("protected asset tables all survive the replay", async () => {
    const rows = await c.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [
        [
          "restaurants",
          "crew_accounts",
          "crew_role_sessions",
          "role_session_tokens",
          "manager_accounts",
          "area_manager_accounts",
          "crew_pairing_requests",
          "admin_audit_log",
          "table_occupancy_state",
          "table_occupancy_revisions",
          "lookup_rate_limits",
        ],
      ],
    );
    expect(rows.rows[0].n).toBe(11);
  });
});
```

- [ ] **Step 1.2: Jalankan, pastikan GAGAL dengan alasan benar**

Run: `npx vitest run tests/db/point-6-1-crew-auth-method.test.ts`
Expected: FAIL — `function public.crew_auth_method(...) does not exist` (migration belum ada). Kalau gagal karena hal lain (harness/port), perbaiki itu dulu.

- [ ] **Step 1.3: Tulis migration**

`supabase/migrations/20260915120000_crew_auth_method.sql`:

```sql
-- Poin 6.1: login password crew. ADDITIVE ONLY — nol drop/alter objek apa pun.
-- 1) crew_auth_method: verdict 'password' vs 'otp' (dieksekusi lewat service-role
--    server fn saja; nilai 'otp' juga menutup kasus "email belum ada" supaya
--    enumeration tetap kabur).
-- 2) crew_auth_method_limits + reserve_crew_auth_method: kuota burst 50 lookup /
--    window 15 menit per IP-hash, blokir 15 menit. (lookup_rate_limits existing
--    TIDAK dipakai: semantiknya 'kegagalan' milik fitur lain dan ambang 5/15mnt
--    akan mengunci satu resto lewat NAT saat pergantian shift.)

CREATE TABLE IF NOT EXISTS public.crew_auth_method_limits (
  ip_hash text PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0 CHECK (calls >= 0),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

ALTER TABLE public.crew_auth_method_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_auth_method_limits FROM public, anon, authenticated;
GRANT ALL ON public.crew_auth_method_limits TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_crew_auth_method(p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_blocked timestamptz;
BEGIN
  INSERT INTO public.crew_auth_method_limits AS l
    (ip_hash, calls, window_started_at, blocked_until)
  VALUES (p_ip_hash, 1, now(), NULL)
  ON CONFLICT (ip_hash) DO UPDATE SET
    calls = CASE
      WHEN l.window_started_at <= now() - interval '15 minutes' THEN 1
      ELSE l.calls + 1
    END,
    window_started_at = CASE
      WHEN l.window_started_at <= now() - interval '15 minutes' THEN now()
      ELSE l.window_started_at
    END,
    blocked_until = CASE
      WHEN l.blocked_until > now() THEN l.blocked_until
      WHEN l.window_started_at > now() - interval '15 minutes' AND l.calls + 1 > 50
        THEN now() + interval '15 minutes'
      ELSE NULL
    END
  RETURNING l.blocked_until INTO v_blocked;
  RETURN v_blocked IS NULL OR v_blocked <= now();
END;
$$;

CREATE OR REPLACE FUNCTION public.crew_auth_method(p_email text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE lower(btrim(u.email)) = lower(btrim(p_email))
      AND coalesce(u.encrypted_password, '') <> ''
  ) THEN 'password' ELSE 'otp' END;
$$;

REVOKE ALL ON FUNCTION public.reserve_crew_auth_method(text), public.crew_auth_method(text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_crew_auth_method(text), public.crew_auth_method(text) TO service_role;
```

- [ ] **Step 1.4: Jalankan test, pastikan 11/11 PASS**

Run: `npx vitest run tests/db/point-6-1-crew-auth-method.test.ts`
Expected: semua pass. Catatan review: kalau `RETURNING l.blocked_until` ditolak parser, gunakan `RETURNING blocked_until` (tanpa alias) — perilaku sama.

- [ ] **Step 1.5: Typecheck + commit**

Run: `npm run typecheck` → exit 0.
`git add supabase/migrations/20260915120000_crew_auth_method.sql tests/db/point-6-1-crew-auth-method.test.ts && git commit -m "feat(poin-6.1): crew_auth_method verdict RPC + 50/15mnt burst quota (additive)"`

---

### Task 2: Server fn anonim `crewLoginMethod`

**Files:**
- Modify: `src/lib/crew-auth.server.ts`
- Test: `tests/point-6-1-crew-login-method.test.ts`

- [ ] **Step 2.1: Tulis test core yang gagal**

`tests/point-6-1-crew-login-method.test.ts`:

```ts
// Poin 6.1 S2: crewLoginMethodCore contract — quota first, verdict second,
// fail-closed everywhere. RPC injected, no network.
import { describe, expect, test, vi } from "vitest";
import { crewLoginMethodCore } from "@/lib/crew-auth.server";

const ok = (data: unknown) => Promise.resolve({ data, error: null });
const boom = (message: string) => Promise.resolve({ data: null, error: { message } });

describe("crewLoginMethodCore", () => {
  test("throttled when the bucket denies the call (no verdict call happens)", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(false));
    const result = await crewLoginMethodCore(
      { email: "budi@ex.test", ipHash: "h" },
      rpc,
    );
    expect(result).toEqual({ ok: false, code: "THROTTLED" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe("reserve_crew_auth_method");
    expect(rpc.mock.calls[0][1]).toEqual({ p_ip_hash: "h" });
  });

  test("verdict password passes through after quota allows", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok("password"));
    await expect(crewLoginMethodCore({ email: "budi@ex.test", ipHash: "h" }, rpc)).resolves.toEqual(
      { ok: true, method: "password" },
    );
    expect(rpc.mock.calls[1]).toEqual(["crew_auth_method", { p_email: "budi@ex.test" }]);
  });

  test("any RPC error fail-closes to UNAVAILABLE", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(ok(true)).mockResolvedValueOnce(boom("nope"));
    await expect(crewLoginMethodCore({ email: "b@ex.test", ipHash: "h" }, rpc)).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  test("quota RPC error fail-closes to UNAVAILABLE (never defaults open)", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(boom("db down"));
    await expect(crewLoginMethodCore({ email: "b@ex.test", ipHash: "h" }, rpc)).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  test("a verdict outside the two values fail-closes to UNAVAILABLE", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce(ok(true))
      .mockResolvedValueOnce(ok("sesuatu-yang-janggal"));
    await expect(crewLoginMethodCore({ email: "b@ex.test", ipHash: "h" }, rpc)).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});
```

- [ ] **Step 2.2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/point-6-1-crew-login-method.test.ts`
Expected: FAIL — `crewLoginMethodCore` is not exported (import error).

- [ ] **Step 2.3: Implementasi di `src/lib/crew-auth.server.ts`**

Tambahkan di bagian atas (dekat konstanta GENERIC):

```ts
const GENERIC_LOGIN_METHOD = "Gagal memeriksa akun.";
```

Tambahkan section baru (setelah `crewValidateCode`, sebelum `crewRequestPairing`):

```ts
// ---------------------------------------------------------------------------
// crewLoginMethod (Poin 6.1: email-first routing 'password' vs 'otp')
// ---------------------------------------------------------------------------

export type CrewLoginMethodResult =
  | { ok: true; method: "password" | "otp" }
  | { ok: false; code: "THROTTLED" | "UNAVAILABLE"; message?: string };

export const crewLoginMethodInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

export async function crewLoginMethodCore(
  data: { email: string; ipHash: string },
  rpc: RpcCaller,
): Promise<CrewLoginMethodResult> {
  try {
    const { data: allowed, error: quotaError } = await rpc("reserve_crew_auth_method", {
      p_ip_hash: data.ipHash,
    });
    if (quotaError || typeof allowed !== "boolean") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_LOGIN_METHOD };
    }
    if (!allowed) return { ok: false, code: "THROTTLED", message: GENERIC_LOGIN_METHOD };
    const { data: verdict, error } = await rpc("crew_auth_method", { p_email: data.email });
    if (error || (verdict !== "password" && verdict !== "otp")) {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_LOGIN_METHOD };
    }
    return { ok: true, method: verdict };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_LOGIN_METHOD };
  }
}

export const crewLoginMethod = createServerFn({ method: "POST" })
  .validator(crewLoginMethodInputSchema)
  .handler(async ({ data }): Promise<CrewLoginMethodResult> => {
    // node:crypto + the service client are dynamic imports on purpose: this
    // module sits on the client import graph via CrewLoginFlow (see file
    // header, guarded by tests/restaurant-login-build.test.ts).
    const { createHmac } = await import("node:crypto");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { getLoginRequestIp } = await import("./login-request-ip.server");
    const { getAuthSecret } = await import("./auth.server");
    const { getServiceClient } = await import("./remote-audio.server");
    const client = getServiceClient();
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_LOGIN_METHOD };
    const ip = getLoginRequestIp(getRequest().headers);
    const ipHash = createHmac("sha256", getAuthSecret())
      .update(`crew-method:${ip}`)
      .digest("hex");
    return crewLoginMethodCore(
      { email: data.email, ipHash },
      async (fn, params) => client.rpc(fn, params),
    );
  });
```

Catatan executor: file `crew-auth.server.ts` punya header komentar "service-role client can never call these RPCs" — itu berlaku utk RPC akun crew lama; `crew_auth_method`/`reserve_crew_auth_method` justru DIRANCANG service_role-only (lihat GRANT di migration). Tambahkan 1 kalimat klarifikasi di header file bahwa kedua fungsi Poin 6.1 adalah pengecualian yang disengaja, supaya pembaca berikutnya tidak bingung.

- [ ] **Step 2.4: Jalankan test, PASS; typecheck + lint per-file**

Run: `npx vitest run tests/point-6-1-crew-login-method.test.ts` → 5/5 pass.
Run: `npm run typecheck` → exit 0.
Run: `npx eslint src/lib/crew-auth.server.ts tests/point-6-1-crew-login-method.test.ts` → exit 0.

- [ ] **Step 2.5: Commit**

`git add src/lib/crew-auth.server.ts tests/point-6-1-crew-login-method.test.ts && git commit -m "feat(poin-6.1): crewLoginMethod server fn — quota-first, fail-closed, enumeration kabur"`

---

### Task 3: browser-auth — `crewSignInWithPassword` + `crewSetPassword`

**Files:**
- Modify: `src/lib/browser-auth.ts`
- Test: `tests/point-6-1-browser-auth.test.ts`

- [ ] **Step 3.1: Tulis test yang gagal**

`tests/point-6-1-browser-auth.test.ts` — pola mock `@supabase/supabase-js` mengikuti `tests/point-3-browser-auth.test.ts` yang sudah ada (module factory `createClient` mengembalikan stub `auth`). If the existing file already stubs the module globally, replicate the same minimal stub here:

```ts
// Poin 6.1 S3: password sign-in classification (INVALID_CREDENTIALS must be
// distinguishable from transport death) + set-password weak mapping.
import { beforeEach, describe, expect, test, vi } from "vitest";

const authStub = {
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
};
const clientStub = { auth: authStub };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => clientStub,
}));

import { crewSetPassword, crewSignInWithPassword } from "@/lib/browser-auth";

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
  authStub.signInWithPassword.mockReset();
  authStub.updateUser.mockReset();
});

function err(status: number | undefined, message: string) {
  return { error: Object.assign(new Error(message), { status }) };
}

describe("crewSignInWithPassword", () => {
  test("success", async () => {
    authStub.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    await expect(crewSignInWithPassword("b@ex.test", "rahasia1")).resolves.toEqual({ ok: true });
  });

  test("wrong credentials => INVALID_CREDENTIALS (not UNAVAILABLE)", async () => {
    authStub.signInWithPassword.mockResolvedValue(err(undefined, "Invalid login credentials"));
    await expect(crewSignInWithPassword("b@ex.test", "salah")).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
  });

  test("429 => RATE_LIMITED", async () => {
    authStub.signInWithPassword.mockResolvedValue(err(429, "over_email_send_rate_limit"));
    await expect(crewSignInWithPassword("b@ex.test", "x")).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
    });
  });

  test("network throw => UNAVAILABLE", async () => {
    authStub.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(crewSignInWithPassword("b@ex.test", "x")).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("crewSetPassword", () => {
  test("updateUser ok", async () => {
    authStub.updateUser.mockResolvedValue({ data: {}, error: null });
    await expect(crewSetPassword("rahasia1")).resolves.toEqual({ ok: true });
  });

  test("below-minimum message => WEAK (client shows local copy)", async () => {
    authStub.updateUser.mockResolvedValue(
      err(undefined, "Password should be at least 6 characters"),
    );
    await expect(crewSetPassword("123")).resolves.toEqual({ ok: false, code: "WEAK" });
  });

  test("network throw => UNAVAILABLE", async () => {
    authStub.updateUser.mockRejectedValue(new TypeError("offline"));
    await expect(crewSetPassword("rahasia1")).resolves.toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
```

- [ ] **Step 3.2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/point-6-1-browser-auth.test.ts`
Expected: FAIL — `crewSignInWithPassword`/`crewSetPassword` bukan ekspor (import undefined / TypeError not a function).

- [ ] **Step 3.3: Implementasi di `src/lib/browser-auth.ts`**

Tambah setelah blok `crewVerifyOtp` (reuse `attempt`/`classifyAuthFailure` module-private yang sudah ada):

```ts
// --- Poin 6.1: password login + self-service password setup ---------------

export type CrewPasswordSignInResult =
  | { ok: true }
  | { ok: false; code: "INVALID_CREDENTIALS" | "RATE_LIMITED" | "UNAVAILABLE" };

export async function crewSignInWithPassword(
  email: string,
  password: string,
): Promise<CrewPasswordSignInResult> {
  const c = getSupabaseBrowserClient();
  if (!c) return { ok: false, code: "UNAVAILABLE" };
  try {
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (!error) return { ok: true };
    if (/invalid login credentials/i.test((error as { message?: string }).message ?? "")) {
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    return { ok: false, code: classifyAuthFailure(error) };
  } catch (err) {
    if (/invalid login credentials/i.test((err as { message?: string }).message ?? "")) {
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }
    return { ok: false, code: classifyAuthFailure(err) };
  }
}

export type CrewSetPasswordResult = { ok: true } | { ok: false; code: "WEAK" | "UNAVAILABLE" };

export async function crewSetPassword(password: string): Promise<CrewSetPasswordResult> {
  const c = getSupabaseBrowserClient();
  if (!c) return { ok: false, code: "UNAVAILABLE" };
  try {
    const { error } = await c.auth.updateUser({ password });
    if (!error) return { ok: true };
    if (/at least/i.test((error as { message?: string }).message ?? "")) {
      return { ok: false, code: "WEAK" };
    }
    return { ok: false, code: "UNAVAILABLE" };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
```

- [ ] **Step 3.4: Jalankan test, PASS; regression suite browser-auth lama tetap hijau**

Run: `npx vitest run tests/point-6-1-browser-auth.test.ts tests/point-3-browser-auth.test.ts` → semua pass (13 + 8).
Run: `npm run typecheck` → exit 0.

- [ ] **Step 3.5: Commit**

`git add src/lib/browser-auth.ts tests/point-6-1-browser-auth.test.ts && git commit -m "feat(poin-6.1): crewSignInWithPassword + crewSetPassword with honest failure codes"`

---

### Task 4: Rewrite `CrewLoginFlow` (state machine email-first + gate Buat Password + fix pairing)

**Files:**
- Modify: `src/components/CrewLoginFlow.tsx`
- Test: `tests/point-6-1-crew-login-flow.test.tsx` (baru)
- Modify test: `tests/point-3-crew-login-flow.test.tsx` (adaptasi jalur OTP → kini lewat `setPassword`)

- [ ] **Step 4.1: Tulis test komponen baru yang gagal**

`tests/point-6-1-crew-login-flow.test.tsx` — ikuti pola mock `point-3-crew-login-flow.test.tsx` (mock `@/lib/crew-auth.server`, `@/lib/browser-auth`), Tambah mock `crewLoginMethod`, `crewSignInWithPassword`, `crewSetPassword`, dan `sonner`:

```ts
// @vitest-environment jsdom
// Poin 6.1 S4: the email-first machine on REAL components. Asserts: routing by
// crewLoginMethod verdict, the mandatory setPassword gate on EVERY OTP entry,
// the fresh pairing field, no "Sudah punya kode?" button, in-place retry for
// transient post-login failures, and busy-disabled submits (owner rule).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const crewLoginMethod = vi.fn();
const crewMe = vi.fn();
const crewValidateCode = vi.fn();
const crewRequestPairing = vi.fn();
const crewConfirmPairing = vi.fn();
const crewClaimShift = vi.fn();
const crewSignInWithOtp = vi.fn();
const crewVerifyOtp = vi.fn();
const crewSignInWithPassword = vi.fn();
const crewSetPassword = vi.fn();
const refreshCarrierToken = vi.fn();
const getDeviceToken = vi.fn();
const crewSignOut = vi.fn();
const toastSuccess = vi.fn();

vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m) } }));
vi.mock("@/lib/crew-auth.server", () => ({
  crewLoginMethod: (a: { data: { email: string } }) => crewLoginMethod(a),
  crewMe: (a: unknown) => crewMe(a),
  crewValidateCode: (a: unknown) => crewValidateCode(a),
  crewRequestPairing: (a: unknown) => crewRequestPairing(a),
  crewConfirmPairing: (a: unknown) => crewConfirmPairing(a),
  crewClaimShift: (a: unknown) => crewClaimShift(a),
}));
vi.mock("@/lib/browser-auth", () => ({
  crewSignInWithOtp: (email: string) => crewSignInWithOtp(email),
  crewVerifyOtp: (email: string, otp: string) => crewVerifyOtp(email, otp),
  crewSignInWithPassword: (email: string, password: string) =>
    crewSignInWithPassword(email, password),
  crewSetPassword: (password: string) => crewSetPassword(password),
  crewSignOut: () => crewSignOut(),
  refreshCarrierToken: () => refreshCarrierToken(),
  getDeviceToken: () => getDeviceToken(),
}));

import { CrewLoginFlow } from "../src/components/CrewLoginFlow";

const REST = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const DEVICE = "11111111-2222-4222-8222-333333333333";
const EMAIL = "budi@example.com";

const okMeUnpaired = {
  ok: true, paired: false, status: null, fullName: null,
  restaurantId: null, restaurantName: null, deviceCurrent: false,
};
const okMePaired = {
  ok: true, paired: true, status: "aktif", fullName: "Budi",
  restaurantId: REST, restaurantName: "RMuji", deviceCurrent: true,
};

beforeEach(() => {
  crewLoginMethod.mockReset().mockResolvedValue({ ok: true, method: "otp" });
  crewMe.mockReset().mockResolvedValue(okMePaired);
  crewValidateCode.mockReset();
  crewRequestPairing.mockReset();
  crewConfirmPairing.mockReset();
  crewClaimShift.mockReset();
  crewSignInWithOtp.mockReset().mockResolvedValue({ ok: true });
  crewVerifyOtp.mockReset().mockResolvedValue({ ok: true });
  crewSignInWithPassword.mockReset().mockResolvedValue({ ok: true });
  crewSetPassword.mockReset().mockResolvedValue({ ok: true });
  // Boot default: NO persisted session — the flow must land on the email step.
  refreshCarrierToken.mockReset().mockResolvedValue(null);
  getDeviceToken.mockReset().mockReturnValue(DEVICE);
  crewSignOut.mockReset();
  toastSuccess.mockReset();
});

afterEach(cleanup);

function flow() {
  return render(
    <CrewLoginFlow
      onSsContinue={vi.fn()}
      onRoleContinue={vi.fn()}
      resendCooldownMs={0}
      sessionRetryMs={0}
    />,
  );
}

async function submitEmail() {
  await flow();
  await waitFor(() => expect(screen.getByLabelText("Email")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByRole("button", { name: /Lanjut/i }));
}

// From here on the browser has a live GoTrue session; every helper that
// crosses a login boundary flips this FIRST so sessionAndDevice() succeeds.
function liveSession() {
  refreshCarrierToken.mockResolvedValue("jwt-1");
}

async function passOtpVerification() {
  await waitFor(() => expect(screen.getByLabelText("Kode email")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Kode email"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: /Verifikasi/i }));
}

async function passSetPasswordGate() {
  await waitFor(() => expect(screen.getByLabelText("Password baru")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Password baru"), { target: { value: "rahasia1" } });
  fireEvent.change(screen.getByLabelText("Ulangi password"), { target: { value: "rahasia1" } });
  liveSession();
  fireEvent.click(screen.getByRole("button", { name: /Simpan Password/i }));
}

describe("routing by verdict", () => {
  it("method=password shows the password screen (and crewLoginMethod got the email)", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    await submitEmail();
    expect(crewLoginMethod).toHaveBeenCalledWith({ data: { email: EMAIL } });
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());
    expect(crewSignInWithOtp).not.toHaveBeenCalled();
  });

  it("password ok lands on checkin without touching setPassword", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "rahasia1" } });
    liveSession();
    fireEvent.click(screen.getByRole("button", { name: /Masuk/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Kasir/i })).toBeInTheDocument(),
    );
    expect(crewSetPassword).not.toHaveBeenCalled();
  });

  it("wrong password => neutral copy + lupa link, no OTP yet", async () => {
    crewLoginMethod.mockResolvedValueOnce({ ok: true, method: "password" });
    crewSignInWithPassword.mockResolvedValueOnce({ ok: false, code: "INVALID_CREDENTIALS" });
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "salah" } });
    fireEvent.click(screen.getByRole("button", { name: /Masuk/i }));
    await waitFor(() =>
      expect(screen.getByText("Email atau password salah.")).toBeInTheDocument(),
    );
    expect(crewSignInWithOtp).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /kirim kode email/i }));
    await waitFor(() => expect(crewSignInWithOtp).toHaveBeenCalledWith(EMAIL));
  });
});

describe("OTP gate leads to setPassword everywhere", () => {
  it("new email: verify then setPassword then resto step", async () => {
    crewMe.mockResolvedValue(okMeUnpaired);
    await submitEmail();
    await waitFor(() => expect(crewSignInWithOtp).toHaveBeenCalledWith(EMAIL));
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(crewSetPassword).toHaveBeenCalledWith("rahasia1"));
    expect(toastSuccess).toHaveBeenCalledWith("Password tersimpan");
    await waitFor(() => expect(screen.getByLabelText("Kode Resto")).toBeInTheDocument());
  });

  it("mismatched confirmation is refused locally (no network)", async () => {
    await submitEmail();
    await passOtpVerification();
    await waitFor(() => expect(screen.getByLabelText("Password baru")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Password baru"), { target: { value: "rahasia1" } });
    fireEvent.change(screen.getByLabelText("Ulangi password"), { target: { value: "lain123" } });
    fireEvent.click(screen.getByRole("button", { name: /Simpan Password/i }));
    expect(crewSetPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/belum sama/i)).toBeInTheDocument();
  });

  it("paired old crew: setPassword gate BEFORE checkin (owner rule)", async () => {
    await submitEmail();
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Kasir/i })).toBeInTheDocument(),
    );
  });
});

describe("pairing screen fixes", () => {
  it("waiting shows the manager-code input immediately, EMPTY, no extra button", async () => {
    crewMe.mockResolvedValue(okMeUnpaired);
    crewValidateCode.mockResolvedValue({
      ok: true, restaurantId: REST, displayName: "RMuji",
    });
    crewRequestPairing.mockResolvedValue({ ok: true, requestId: "550e8400-e29b-41d4-a716-446655440000" });
    await submitEmail();
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(screen.getByLabelText("Kode Resto")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Nama"), { target: { value: "Budi" } });
    fireEvent.change(screen.getByLabelText("Kode Resto"), { target: { value: "GACOAN" } });
    fireEvent.click(screen.getByRole("button", { name: /Cek Kode/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Lanjutkan/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Lanjutkan/i }));
    await waitFor(() => expect(screen.getByLabelText(/kode dari manager/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/kode dari manager/i)).toHaveAttribute("value", "");
    expect(screen.queryByText(/sudah punya kode/i)).not.toBeInTheDocument();
  });
});

describe("in-place retry replaces the email-loop bug", () => {
  it("transient crew_me failure keeps the session and offers Coba lagi", async () => {
    crewMe.mockResolvedValueOnce({ ok: false, code: "UNAVAILABLE", message: "x" });
    await submitEmail();
    await passOtpVerification();
    await passSetPasswordGate();
    await waitFor(() => expect(screen.getByText(/Gagal memuat data/i)).toBeInTheDocument());
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    crewMe.mockResolvedValueOnce(okMePaired);
    fireEvent.click(screen.getByRole("button", { name: /Coba lagi/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Kasir/i })).toBeInTheDocument(),
    );
  });
});

describe("busy-disable rule (owner: one click, buttons lock)", () => {
  it("Verifikasi button is disabled while the network call is in flight", async () => {
    let resolveVerify: (v: { ok: boolean }) => void = () => {};
    crewVerifyOtp.mockImplementationOnce(
      () => new Promise((r) => { resolveVerify = r; }),
    );
    await submitEmail();
    await waitFor(() => expect(screen.getByLabelText("Kode email")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Kode email"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /Verifikasi/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Verifikasi/i })).toBeDisabled(),
    );
    resolveVerify({ ok: true });
  });
});
```

- [ ] **Step 4.2: Jalankan, pastikan GAGAL dengan alasan benar**

Run: `npx vitest run tests/point-6-1-crew-login-flow.test.tsx`
Expected: FAIL (komponen lama: tidak ada step password/setPassword, tombol "Lanjut" lama bernama "Kirim Kode", pairing masih pakai state lama).

- [ ] **Step 4.3 (rewrite): Ubah `CrewLoginFlow.tsx` sesuai spesifikasi desain**

Perubahan lengkap — jaga SEMUA markup conventions (AuthLayout, IconField, Alert, taPrimaryButtonClass) dan semua handler pairing/claim/kick yang tidak disebut di bawah:

a. **Type + state + prop seam baru**

```ts
type Step =
  | "boot" | "email" | "password" | "otpEmail" | "setPassword"
  | "resto" | "waiting" | "checkin" | "kicked" | "disabled";

const [otpPairing, setOtpPairing] = useState("");   // form pairing, terpisah dari otp
const [wizardMode, setWizardMode] = useState<"otp" | "password" | null>(null);
const [badPassword, setBadPassword] = useState(false);
const [pw1, setPw1] = useState("");
const [pw2, setPw2] = useState("");
const [showPw, setShowPw] = useState(false);
const [retryable, setRetryable] = useState<{ run: () => void } | null>(null);
const lastRouteTarget = useRef<Step>("email");
```

Prop seam (ikut pola `resendCooldownMs` yang sudah ada): `sessionRetryMs?: number` default `1000` — dipakai `sessionAndDevice`; test jsdom mengisi `0`. Tambahkan ke `CrewLoginFlowProps` + destructuring + JSDoc satu baris.

Hapus `showPairingOtp`. Copy baru (persis):

```ts
const PW_BAD_CREDENTIALS = "Email atau password salah.";
const PW_MISMATCH = "Ulangi password belum sama.";
const PW_MIN = "Password minimal 6 karakter.";
const LOOKUP_THROTTLED = "Terlalu sering mencoba. Tunggu sekitar 15 menit lalu coba lagi.";
const ROUTE_TRANSIENT = "Gagal memuat data. Coba lagi.";
const PW_SAVED_TOAST = "Password tersimpan";
const OTP_SENT_TOAST = "Kode dikirim ke email";
```

b. **`sessionAndDevice` retry 1×** (anti-WiFi-kedip; 1 detik):

```ts
async function sessionAndDevice(): Promise<{ token: string; device: string } | null> {
  let token = await refreshCarrierToken();
  if (!token) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    token = await refreshCarrierToken();
  }
  const device = getDeviceToken();
  if (!token || !device) return null;
  return { token, device };
}
```

c. **`routeSession`** — simpan target utk retry; bedakan kegagalan:

```ts
async function routeSession(accessToken: string, deviceToken: string, unpairedTarget: Step): Promise<void> {
  lastRouteTarget.current = unpairedTarget;
  const me = await crewMe({ data: { accessToken, deviceToken } });
  if (!me.ok) {
    if (me.code === "UNAUTHORIZED") {
      setStep("email");
      setError(SESSION_LOST);
      setRetryable(null);
      return;
    }
    setError(ROUTE_TRANSIENT);
    setRetryable({
      run: () => void routeWithFreshSession(lastRouteTarget.current ?? "email"),
    });
    return;
  }
  setRetryable(null);
  // ...sisa logika lama (paired/status/deviceCurrent) TIDAK berubah
}

async function routeWithFreshSession(target: Step): Promise<void> {
  const session = await sessionAndDevice();
  if (!session) { setStep("email"); setError(SESSION_LOST); setRetryable(null); return; }
  await routeSession(session.token, session.device, target);
}
```

d. **`submitEmail`** (pengganti `sendOtp`, tombol "Lanjut"): `busy` guard + `Date.now() < sendUntil`; panggil `crewLoginMethod({ data: { email: email.trim().toLowerCase() } })`; `!ok && code==="THROTTLED"` → Alert `LOOKUP_THROTTLED`; `!ok` lainnya → Alert `ROUTE_TRANSIENT` + `setRetryable({ run: () => void submitEmail-ish })` (simpan closure submit); `method==="password"` → `setWizardMode("password")`, `setStep("password")`, busy false; `method==="otp"` → lanjut kirim OTP seperti `sendOtp` lama (sukses: `setSendUntil`, `setOtp("")`, `setWizardMode("otp")`, `setStep("otpEmail")`, `toast.success(OTP_SENT_TOAST)`).

e. **`submitPassword`** baru (tombol "Masuk"): `crewSignInWithPassword(email.trim().toLowerCase(), pw)` → ok: `setWizardMode("password")` sudah set; `sessionAndDevice()` → `routeSession(token, device, "resto")`; `INVALID_CREDENTIALS` → `setBadPassword(true)` + Alert `PW_BAD_CREDENTIALS`; `RATE_LIMITED`/`UNAVAILABLE` → Alert `OTP_RATE_LIMITED`/`ROUTE_TRANSIENT` + retryable submit. Link lupa (muncul hanya saat `badPassword`): `<button type="button">Belum bisa masuk? Kirim kode email</button>` → panggil alur kirim OTP + `setWizardMode("otp")` + `setStep("otpEmail")`.

f. **`verifyOtp`** (tombol "Verifikasi"): sukses → TIDAK lagi `routeSession` langsung; `setOtp("")`, `setPw1("")`, `setPw2("")`, `setStep("setPassword")`. Gagal → `OTP_EMAIL_BAD` + resend (logika lama, pakai state `otp`).

g. **`submitSetPassword`** baru (tombol "Simpan Password"): guard lokal `pw1.length < 6 → PW_MIN`, `pw1 !== pw2 → PW_MISMATCH` (tanpa network); `crewSetPassword(pw1)` → ok: `toast.success(PW_SAVED_TOAST)`, `sessionAndDevice()` → `routeSession(token, device, "resto")`; `WEAK` → Alert `PW_MIN`; `UNAVAILABLE` → Alert `ROUTE_TRANSIENT` (tetap di step, sesi utuh, tombol muncul lagi via retryable = closure `submitSetPassword`).

h. **`requestPairing` sukses**: `setOtpPairing("")` SEBELUM `setStep("waiting")`; hapus `setShowPairingOtp`.

i. **`confirmPairing`**: pakai `otpPairing` (guard length 6), reset `setOtpPairing("")` saat sukses burn/stale.

j. **Layar `waiting`**: hapus blok tombol "Sudah punya kode? Masukkan"; form pairing langsung tampil dengan `IconField` `aria-label="Kode dari Manager"`, `value={otpPairing}`, `id="pairing-otp"`, `autoFocus`, submit "Register Device" (label lama dipertahankan). `otpPairing.length !== 6` → disabled.

k. **Layar `setPassword`**: judul "Buat Password", subteks "Password dipakai untuk login berikutnya, tanpa kode email."; dua `IconField` `aria-label="Password baru"` (`type` mengikuti `showPw`) dengan trailing slot mata (`lucide` `Eye`/`EyeOff`, `autoComplete="new-password"`) + `aria-label="Ulangi password"` (`autoComplete="new-password"`); Alert error; tombol "Simpan Password".

l. **Layar `password`**: judul "Masuk", `aria-label="Password"`, `autoComplete="current-password"`, Enter submit (bentuk form), tombol "Masuk", link lupa di (e).

m. **Dots progres**: render hanya saat `wizardMode === "otp"`, `OTP_STEPS: Step[] = ["email","otpEmail","setPassword","resto","waiting","checkin"]`.

n. **`claimShift`, `checkRestoCode`, layar resto/kicked/disabled, `signOutAccount`, countdown heartbeat**: TIDAK berubah (kecuali `confirmPairing`/pairing field di j/i).

o. **Render Alert + retry in-place**: di step mana pun setelah login (password/otpEmail/setPassword/resto/checkin) — jika `retryable` terisi, tampilkan `<button type="button" onClick={() => retryable?.run()}>…Coba lagi</button>` di bawah Alert, TANPA mengubah step.

p. **Header komentar file**: tambah catatan Poin 6.1 (satu paragraf: magic link turun pangkat jadi alat setup/reset; gate setPassword wajib; pairing field baru).

- [ ] **Step 4.4: Jalankan test baru → PASS (semua describe hijau)**

Run: `npx vitest run tests/point-6-1-crew-login-flow.test.tsx`
Expected: semua pass.

- [ ] **Step 4.5: Adaptasi `tests/point-3-crew-login-flow.test.tsx` (BUKAN men-skip)**

Jalur OTP pada file lama kini punya step `setPassword` sebelum routing: tambahkan mock `crewLoginMethod` (default `{ ok: true, method: "otp" }`), `crewSignInWithPassword`, `crewSetPassword` (`mockResolvedValue({ ok: true })`) ke kedua `vi.mock` factory, dan helper:

```ts
async function passSetPasswordGate() {
  await waitFor(() => expect(screen.getByLabelText("Password baru")).toBeInTheDocument());
  fireEvent.change(screen.getByLabelText("Password baru"), { target: { value: "rahasia1" } });
  fireEvent.change(screen.getByLabelText("Ulangi password"), { target: { value: "rahasia1" } });
  fireEvent.click(screen.getByRole("button", { name: /Simpan Password/i }));
}
```

Sisipkan `await passSetPasswordGate()` setelah tiap `verifyOtp` sukses di test yang melanjutkan ke resto/checkin. Rename label tombol lama yang di-assert (`"Kirim Kode"` → `"Lanjut"` hanya pada test submit email pertama; test yang mengharapkan `crewSignInWithOtp` tetap valid). Jangan hapus assertion lama; setiap test yang berubah harus tetap membuktikan kontrak Poin 3 (payload `onSsContinue`/`onRoleContinue`, kick, disabled, resend cooldown).

Run: `npx vitest run tests/point-3-crew-login-flow.test.tsx tests/crew-login-code.test.ts` → pass penuh.

- [ ] **Step 4.6: Typecheck + lint file yang disentuh + commit**

`npm run typecheck` → 0. `npx eslint src/components/CrewLoginFlow.tsx tests/point-6-1-crew-login-flow.test.tsx tests/point-3-crew-login-flow.test.tsx` → 0.
`git add -A src/components/CrewLoginFlow.tsx tests/point-6-1-crew-login-flow.test.tsx tests/point-3-crew-login-flow.test.tsx && git commit -m "feat(poin-6.1): crew login email-first + wajib setPassword; fix pairing field & loop-login"`

---

### Task 5: Update Prompt (semua role) + mount `<Toaster/>` di root

**Files:**
- Create: `src/lib/update-prompt.ts`, `src/components/UpdatePrompt.tsx`
- Modify: `src/routes/__root.tsx`
- Test: `tests/point-6-1-update-prompt.test.tsx`

- [ ] **Step 5.1: Tulis test yang gagal**

`tests/point-6-1-update-prompt.test.tsx`:

```ts
// @vitest-environment jsdom
// Poin 6.1 S5: bundle-hash probe (index-*.js on the live document vs the
// running one), the exact owner-mandated copy, Refresh => location.reload,
// Nanti Aja => dismissed per-build for the whole tab session.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  UPDATE_TEXT,
  currentIndexAsset,
  isChunkLoadError,
  parseIndexAsset,
  shouldPrompt,
} from "@/lib/update-prompt";
import { UpdatePrompt } from "@/components/UpdatePrompt";

const LIVE = '<html><head><script type="module" src="/assets/index-AbC123.js"></script></head><body></body></html>';

beforeEach(() => {
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

afterEach(cleanup);

describe("pure helpers", () => {
  it("parseIndexAsset extracts the hashed entry or null (dev/SSR-safe)", () => {
    expect(parseIndexAsset(LIVE)).toBe("/assets/index-AbC123.js");
    expect(parseIndexAsset("<html></html>")).toBeNull();
  });

  it("currentIndexAsset reads the running document's own entry script", () => {
    const s = document.createElement("script");
    s.setAttribute("src", "/assets/index-RUN001.js");
    document.head.appendChild(s);
    expect(currentIndexAsset()).toBe("/assets/index-RUN001.js");
  });

  it("shouldPrompt: only a different, not-yet-dismissed build nags", () => {
    expect(shouldPrompt("/assets/index-RUN.js", "/assets/index-NEW.js", false)).toBe(true);
    expect(shouldPrompt("/assets/index-RUN.js", "/assets/index-RUN.js", false)).toBe(false);
    expect(shouldPrompt("/assets/index-RUN.js", null, false)).toBe(false);
    expect(shouldPrompt(null, "/assets/index-NEW.js", false)).toBe(false);
    expect(shouldPrompt("/assets/index-RUN.js", "/assets/index-NEW.js", true)).toBe(false);
  });

  it("chunk-load error detector covers Chrome and Safari wording", () => {
    expect(isChunkLoadError("Failed to fetch dynamically imported module: https://x/y.js")).toBe(true);
    expect(isChunkLoadError("Importing a module script failed.")).toBe(true);
    expect(isChunkLoadError("Cannot read properties of undefined")).toBe(false);
  });
});

function runningBuild() {
  const s = document.createElement("script");
  s.setAttribute("src", "/assets/index-RUN001.js");
  document.head.appendChild(s);
}

function stubReload() {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
}

describe("UpdatePrompt component", () => {
  it("Nanti Aja closes, records the dismissal, and the interval stays silent for that build", async () => {
    runningBuild();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => LIVE }));
    render(<UpdatePrompt intervalMs={50} />);
    await waitFor(() => expect(screen.getByText(UPDATE_TEXT)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Nanti Aja" }));
    expect(screen.queryByText(UPDATE_TEXT)).not.toBeInTheDocument();
    await waitFor(() =>
      expect(sessionStorage.getItem("lm.update.dismissed./assets/index-AbC123.js")).toBe("1"),
    );
    await new Promise((r) => setTimeout(r, 160)); // >= 2 extra interval ticks
    expect(screen.queryByText(UPDATE_TEXT)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("Refresh reloads the page", async () => {
    runningBuild();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ text: async () => LIVE }));
    const reload = stubReload();
    render(<UpdatePrompt intervalMs={50} />);
    await waitFor(() => expect(screen.getByText(UPDATE_TEXT)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("fetch failure stays silent", async () => {
    runningBuild();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    render(<UpdatePrompt intervalMs={50} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText(UPDATE_TEXT)).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 5.2: Jalankan, pastikan GAGAL**

Run: `npx vitest run tests/point-6-1-update-prompt.test.tsx`
Expected: FAIL — modul/komponen belum ada.

- [ ] **Step 5.3: Implementasi `src/lib/update-prompt.ts`**

```ts
// Poin 6.1 S5: honest update detection for every role. No version.json, no
// build defines: the running page's own <script src="/assets/index-*.js"> is
// compared against the entry asset referenced by the CURRENT production HTML
// (fetched same-origin, cache-busted). Different file hash == different deploy.
export const UPDATE_TEXT = "Ada Update sistem, Tolong refresh halaman ya.";
export const DISMISS_PREFIX = "lm.update.dismissed.";
export const PROBE_INTERVAL_MS = 5 * 60_000;

const INDEX_ASSET_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

export function parseIndexAsset(html: string): string | null {
  return html.match(INDEX_ASSET_RE)?.[0] ?? null;
}

export function currentIndexAsset(): string | null {
  if (typeof document === "undefined") return null;
  for (const s of Array.from(document.querySelectorAll("script[src]"))) {
    const src = s.getAttribute("src") ?? "";
    const m = src.match(INDEX_ASSET_RE);
    if (m) return m[0];
  }
  return null;
}

export function dismissedBuild(asset: string | null): boolean {
  if (!asset || typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(DISMISS_PREFIX + asset) === "1";
}

export function shouldPrompt(
  current: string | null,
  fetched: string | null,
  isDismissed: boolean,
): boolean {
  return Boolean(current && fetched && current !== fetched && !isDismissed);
}

export function isChunkLoadError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed/i.test(message);
}
```

- [ ] **Step 5.4: Implementasi `src/components/UpdatePrompt.tsx`**

```tsx
"use client";
// Poin 6.1 S5: modal wajib-konfirmasi (owner copy EXACT). "Refresh" reloads;
// "Nanti Aja" silences THIS build for the rest of the tab session — the next
// page load / login session (or a newer build) may prompt again. No ESC, no
// overlay-click dismissal, no silent reload ever.
import { useEffect, useState } from "react";
import {
  DISMISS_PREFIX,
  PROBE_INTERVAL_MS,
  UPDATE_TEXT,
  currentIndexAsset,
  dismissedBuild,
  isChunkLoadError,
  parseIndexAsset,
  shouldPrompt,
} from "@/lib/update-prompt";

export function UpdatePrompt({ intervalMs = PROBE_INTERVAL_MS }: { intervalMs?: number }) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const current = currentIndexAsset();
    if (!current) return;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/?t=${Date.now()}`, { cache: "no-store" });
        const fetched = parseIndexAsset(await res.text());
        if (shouldPrompt(current, fetched, dismissedBuild(fetched))) setPending(fetched);
      } catch {
        /* WiFi kedip: diem total */
      }
    };
    void check();
    const id = setInterval(() => void check(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const message = String((event.reason as { message?: unknown })?.message ?? event.reason ?? "");
      if (isChunkLoadError(message)) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("unhandledrejection", onRejection);
      void stopped;
    };
  }, [intervalMs]);
  if (!pending) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Update sistem"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <p className="text-base font-bold text-ta-gray-900">{UPDATE_TEXT}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white transition hover:bg-brand-600"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.setItem(DISMISS_PREFIX + pending, "1");
              } catch {
                /* storage penuh: biarkan, jangan meledak */
              }
              setPending(null);
            }}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-ta-gray-200 bg-white text-sm font-bold text-ta-gray-700 transition hover:bg-ta-gray-50"
          >
            Nanti Aja
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.5: Mount di `src/routes/__root.tsx` (RootComponent)**

```tsx
import { Toaster } from "@/components/ui/sonner";
import { UpdatePrompt } from "@/components/UpdatePrompt";
// ...
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <UpdatePrompt />
      <Toaster position="top-center" />
    </QueryClientProvider>
```

- [ ] **Step 5.6: Jalankan test → PASS; typecheck; lint**

Run: `npx vitest run tests/point-6-1-update-prompt.test.tsx` → pass (setelah Step 5.1 dicatat→dibersihkan).
Run: `npm run typecheck` → 0; `npx eslint src/lib/update-prompt.ts src/components/UpdatePrompt.tsx src/routes/__root.tsx tests/point-6-1-update-prompt.test.tsx` → 0.

- [ ] **Step 5.7: Commit**

`git add src/lib/update-prompt.ts src/components/UpdatePrompt.tsx src/routes/__root.tsx tests/point-6-1-update-prompt.test.tsx && git commit -m "feat(poin-6.1): update prompt wajib-konfirmasi semua role + mount Toaster"`

---

### Task 6: Build guards (source-scan) — kunci perilaku, cegah regresi sunyi

**Files:**
- Test: `tests/point-6-1-build-guards.test.ts` (baru)

- [ ] **Step 6.1: Tulis test guard**

```ts
// Poin 6.1 S6: source-scan locks (pola tests/point-6-read-transport.test.ts).
// These read SOURCE TEXT on purpose: they fail when someone quietly removes a
// mandated behavior that runtime tests could also miss (old-tab regressions).
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const flow = readFileSync("src/components/CrewLoginFlow.tsx", "utf8");
const root = readFileSync("src/routes/__root.tsx", "utf8");
const update = readFileSync("src/components/UpdatePrompt.tsx", "utf8");

describe("crew login flow (Poin 6.1)", () => {
  test("the magic-link-era button is gone", () => {
    expect(flow).not.toMatch(/Sudah punya kode/i);
  });
  test("pairing keeps its own OTP state", () => {
    expect(flow).toMatch(/otpPairing/);
  });
  test("setPassword gate is mandatory (updateUser path wired)", () => {
    expect(flow).toMatch(/crewSetPassword/);
    expect(flow).toMatch(/crewLoginMethod/);
    expect(flow).toMatch(/crewSignInWithPassword/);
  });
  test("login copy stays exactly as approved", () => {
    expect(flow).toContain("Email atau password salah.");
    expect(flow).toContain("Password minimal 6 karakter.");
    expect(flow).toContain("Ulangi password belum sama.");
  });
});

describe("root shell", () => {
  test("Toaster + UpdatePrompt mounted for ALL roles", () => {
    expect(root).toMatch(/<Toaster/);
    expect(root).toMatch(/<UpdatePrompt/);
  });
  test("prompt copy is the owner's exact string", () => {
    expect(update).toContain("Ada Update sistem, Tolong refresh halaman ya.");
  });
});
```

- [ ] **Step 6.2: Jalankan — harus SUDAH PASS** (mengunci Task 4/5; kalau merah, itu regresi Task 4/5 → perbaiki di sana, bukan di guard).

Run: `npx vitest run tests/point-6-1-build-guards.test.ts` → pass.
Commit: `git add tests/point-6-1-build-guards.test.ts && git commit -m "test(poin-6.1): source-scan guards untuk alur baru + modal update"`

---

### Task 7: Rilis (gate CI + urutan anti-nendang-sesi)

**Files:** tidak ada perubahan kode baru; eksekusi + bukti.

- [ ] **Step 7.1: Full suite lokal TIDAK dilakukan — gate resmi CI.** Push branch `poin-6-1` -> buat PR ke `main` (base `main`, squash nanti). Tunggu `CI / verify` + `db-reset` HIJAU penuh di commit HEAD PR. Kalau merah: PERBAIKI, dilarang bypass/`--no-verify`.

- [ ] **Step 7.2: Apply migration ke PRODUCTION sebelum merge/deploy** (additive; kode baru memanggil RPC baru — urutan ini wajib). Via MCP `supabase_apply_migration` nama `crew_auth_method`. Bukti pre/post di evidence doc nanti:
  - Pre: `select count(*) from information_schema.tables where table_schema='public';` + daftar aset AGENTS §2 (QR tokens, crew_accounts, role_session_tokens, dst) — snapshot angka.
  - Post: tabel +1 (`crew_auth_method_limits`), fungsi +2, SEMUA angka aset identik (nol perubahan), `live auth tokens` tidak berubah (tidak ada patch config).
  - Uji langsung production: `select crew_auth_method('email-punya-password@...')` (via MCP execute_sql service-role) → `'password'`; email tak dikenal → `'otp'`.

- [ ] **Step 7.3: Merge squash ke `main` → Vercel production deploy otomatis.** Cek deployment READY. Ini sekaligus jadi momen UJI Update Prompt di lapangan: tab lama crew HARUS menampilkan modal "Ada Update sistem…" dalam ≤5 menit / saat tab difokuskan ulang.

- [ ] **Step 7.4: Field test pemilik (penutup DONE Poin 6.1):**
  1. Crew lama tanpa password: email → kode → buat password → checkin → claim jalan.
  2. Crew baru: email → kode → buat password → resto → pairing → approve manager → checkin.
  3. Login kedua (password) < 3 detik, tanpa email.
  4. Lupa password: link "Belum bisa masuk" → kode → set ulang → lanjut.
  5. iOS Safari & Android Chrome: modal update muncul setelah deploy, kedua tombol berfungsi.
  6. Sesi crew/manager/SS yang sedang hidup: TIDAK ada yang terlogout.

- [ ] **Step 7.5: Evidence doc** `docs/operations/evidence/production-point-6-1-crew-password-2026-09-15.md` (commit docs lokal dulu; push hanya atas perintah pemilik): CI run IDs, hasil Step 7.2 (angka pre/post), hasil field test, rollback note (lihat Risiko).

**Rollback plan:** revert commit deploy (Vercel instant, alias lama) — RPC/tabel additive TIDAK di-drop (dibiarkan harmless). Data password yang terlanjur dibuat crew tetap valid (jalur OTP-nya otomatis jadi mode password; tidak ada yang rusak).

---

## Risiko yang diterima sadar

- Tab lama pasca-deploy: panggilan `crewMe`/mutasi lama dari tab pre-deploy → risiko fn-hash (preseden §5 Poin 6 diterima); Update Prompt + reload shift = mitigasi baru.
- `crewLoginMethod` membocorkan "email ini punya password" (≡ akun ada) — dibatasi quota 50/15mnt/IP-hash; kasus "belum ada akun" disengaja kabur (sama-sama `otp`).
- 60% iOS: tidak ada API exotic dipakai — `query-` , fetch cache-bust, sessionStorage semua Safari-compliant; uji field wajib device asli.

## Checklist diri leader sebelum handoff eksekusi

- [x] Tidak ada "TBD"/placeholder di plan (blok test UpdatePrompt sudah versi final).
- [x] Nama fungsi/kolom konsisten antar-task (`crew_auth_method`, `reserve_crew_auth_method`, `otpPairing`, `crewSetPassword`, `crewSignInWithPassword`, `DISMISS_PREFIX`).
- [x] Semua requirement spec §2/§3/§4/§5/§6 punya task: 2→T4, 3→T1/T2, 4→T4/T5, 5→T5, 6→urutan T7.
- [ ] Deviasi 1–3 dilaporkan ke pemilik saat handoff.
