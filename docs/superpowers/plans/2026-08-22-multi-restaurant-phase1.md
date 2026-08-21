# Multi-Restaurant Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `restaurants` tenant foundation: table, unique-code rule, backfilled pilot tenant, code-validation domain, and owner-only tenant creation API.

**Architecture:** One Supabase project gains a `restaurants` table keyed by case-insensitive manual codes. Service-role owns all access this phase; crew session binding arrives in Phase 2. Pure validation lives in a shared domain module so later login UI reuses it unchanged.

**Tech Stack:** PostgreSQL/Supabase migration, TanStack Start server functions, Zod, TypeScript, Vitest.

This plan covers **Phase 1 of 6** from `docs/superpowers/specs/2026-08-21-multi-restaurant-design.md`. Phases 2–6 receive their own plans after this one ships.

---

### Task 1: Restaurants migration

**Files:**
- Create: `supabase/migrations/20260822000000_restaurants.sql`
- Modify: `tests/restaurants.test.ts` (new file)

- [ ] **Step 1: Write failing migration test**

Create `tests/restaurants.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260822000000_restaurants.sql", import.meta.url),
  "utf8",
);

it("creates tenant table with case-insensitive unique codes and audit fields", () => {
  expect(migrationSource).toMatch(/create table public\.restaurants \(/i);
  expect(migrationSource).toMatch(
    /create unique index restaurants_code_key on public\.restaurants \(lower\(code\)\)/i,
  );
  expect(migrationSource).toMatch(/is_active boolean not null default true/i);
  expect(migrationSource).toMatch(/deactivated_reason text/i);
  expect(migrationSource).toMatch(/catalog_version integer not null default 1/i);
});

it("denies anon and authenticated access and enables RLS", () => {
  expect(migrationSource).toMatch(/enable row level security/i);
  expect(migrationSource).toMatch(/revoke all on public\.restaurants from anon, authenticated/i);
});

it("backfills the pilot restaurant exactly once", () => {
  expect(migrationSource).toMatch(
    /insert into public\.restaurants \(code, display_name\)\s*values \('KAMPUNG-BULU', 'Mie Gacoan Kampung Bulu'\)\s*on conflict \(lower\(code\)\) do nothing;/i,
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/restaurants.test.ts`
Expected: FAIL with `ENOENT ... 20260822000000_restaurants.sql`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260822000000_restaurants.sql`:

```sql
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  is_active boolean not null default true,
  deactivated_reason text,
  catalog_version integer not null default 1 check (catalog_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index restaurants_code_key on public.restaurants (lower(code));

insert into public.restaurants (code, display_name)
values ('KAMPUNG-BULU', 'Mie Gacoan Kampung Bulu')
on conflict (lower(code)) do nothing;

alter table public.restaurants enable row level security;
revoke all on public.restaurants from anon, authenticated;
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/restaurants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260822000000_restaurants.sql tests/restaurants.test.ts
git commit -m "feat: add restaurants tenant table"
```

### Task 2: Restaurant code domain

**Files:**
- Create: `src/lib/restaurant-domain.ts`
- Modify: `tests/restaurants.test.ts`

- [ ] **Step 1: Write failing domain tests**

Append to `tests/restaurants.test.ts`:

```ts
import {
  normalizeRestaurantCode,
  validateTenantLogin,
  TENANT_PIN,
} from "../src/lib/restaurant-domain";
import { describe } from "vitest";

describe("normalizeRestaurantCode", () => {
  it("trims and uppercases valid codes", () => {
    expect(normalizeRestaurantCode(" kampung-bulu ")).toEqual({ code: "KAMPUNG-BULU" });
  });

  it("rejects empty, short, long, and invalid-character codes", () => {
    expect(normalizeRestaurantCode("")).toEqual({ error: "Kode resto wajib diisi." });
    expect(normalizeRestaurantCode("ab")).toEqual({
      error: "Kode resto 3–32 karakter, huruf/angka/-/_ saja.",
    });
    expect(normalizeRestaurantCode("A".repeat(33))).toEqual({
      error: "Kode resto 3–32 karakter, huruf/angka/-/_ saja.",
    });
    expect(normalizeRestaurantCode("BAD CODE!")).toEqual({
      error: "Kode resto 3–32 karakter, huruf/angka/-/_ saja.",
    });
  });
});

describe("validateTenantLogin", () => {
  it("accepts formal PIN with valid code", () => {
    expect(validateTenantLogin({ code: "kampung-bulu", pin: TENANT_PIN })).toEqual({
      code: "KAMPUNG-BULU",
    });
  });

  it("rejects wrong PIN before touching the code", () => {
    expect(validateTenantLogin({ code: "", pin: "000000" })).toEqual({ error: "PIN salah." });
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/restaurants.test.ts`
Expected: FAIL — cannot resolve `../src/lib/restaurant-domain`.

- [ ] **Step 3: Implement the domain module**

Create `src/lib/restaurant-domain.ts`:

```ts
export const TENANT_PIN = "123456";

const RESTAURANT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/;

export function normalizeRestaurantCode(
  value: string,
): { code: string } | { error: string } {
  const code = value.trim().toUpperCase();
  if (!code) return { error: "Kode resto wajib diisi." };
  if (!RESTAURANT_CODE_PATTERN.test(code))
    return { error: "Kode resto 3–32 karakter, huruf/angka/-/_ saja." };
  return { code };
}

export function validateTenantLogin(input: {
  code: string;
  pin: string;
}): { error: string } | { code: string } {
  if (input.pin !== TENANT_PIN) return { error: "PIN salah." };
  return normalizeRestaurantCode(input.code);
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/restaurants.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/restaurant-domain.ts tests/restaurants.test.ts
git commit -m "feat: add restaurant code validation"
```

### Task 3: Owner-only tenant creation API

**Files:**
- Modify: `src/lib/remote-audio.server.ts` (export `getServiceClient`)
- Create: `src/lib/restaurants.server.ts`
- Create: `tests/restaurants-server.test.ts`

- [ ] **Step 1: Write failing server test**

Create `tests/restaurants-server.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const server = () =>
  readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");

it("exports createRestaurant bound to service-role client behind super admin", () => {
  const source = server();
  expect(source).toContain('createServerFn({ method: "POST" })');
  expect(source).toContain("await requireSuperAdmin();");
  expect(source).toContain('client.from("restaurants").insert');
  expect(source).toContain("restaurants_code_key");
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/restaurants-server.test.ts`
Expected: FAIL — `restaurants.server.ts` does not exist.

- [ ] **Step 3: Export the shared service client**

In `src/lib/remote-audio.server.ts`, change:

```ts
function getServiceClient() {
```

to:

```ts
export function getServiceClient() {
```

- [ ] **Step 4: Implement the server function**

Create `src/lib/restaurants.server.ts`:

```ts
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { normalizeRestaurantCode } from "./restaurant-domain";

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

export const createRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string(), displayName: z.string() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const normalized = normalizeRestaurantCode(data.code);
      if ("error" in normalized) return { error: normalized.error };
      const displayName = data.displayName.trim();
      if (!displayName || displayName.length > 80)
        return { error: "Nama resto 1–80 karakter." };

      const { error } = await client.from("restaurants").insert({
        code: normalized.code,
        display_name: displayName,
      });
      if (error?.message.includes("restaurants_code_key"))
        return { error: "Kode resto sudah dipakai." };
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
  });
```

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/restaurants-server.test.ts && npm test && npx tsc --noEmit && npm run build`
Expected: full suite passes, typecheck clean, build succeeds. Lint stays skipped per user instruction.

- [ ] **Step 6: Commit**

```bash
git add src/lib/remote-audio.server.ts src/lib/restaurants.server.ts tests/restaurants-server.test.ts
git commit -m "feat: add owner-only restaurant creation"
```

### Task 4: Ship and verify remotely

**Files:** none changed.

- [ ] **Step 1: Apply migration**

Run: `npx supabase db push`
Expected: `20260822000000_restaurants.sql` applied.

- [ ] **Step 2: Verify migration list**

Run: `npx supabase migration list`
Expected: local and remote both list `20260822000000`.

- [ ] **Step 3: Verify pilot tenant exists**

Using the service-role debug script pattern from prior sessions, query `restaurants`. Expected: one row, `code=KAMPUNG-BULU`, `is_active=true`, `catalog_version=1`, `display_name='Mie Gacoan Kampung Bulu'`.

- [ ] **Step 4: Push and deploy**

Run: `git push && npx vercel --prod --yes`
Expected: push succeeds; deployment reaches Ready on production alias.

- [ ] **Step 5: Regression check**

On production soundboard, confirm existing crew flow still works (login by name, audio plays). Expected: no behavioral change this phase.
