# Super Admin: Purge Restaurant Test Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a safe reset button in Super Admin restaurant detail page to wipe transient test/operational residue per restaurant without touching master data.

**Architecture:** 
- PostgreSQL RPC `super_admin_purge_restaurant_test_data` handles cascading/safe cleanup of transient tables + bumps occupancy revision.
- TanStack Start Server Function `purgeRestaurantTestData` with super admin auth gate.
- UI Danger Zone Card & AlertDialog confirmation requiring typing `RESET` in `/super-admin/restaurants/$id.tsx`.

**Tech Stack:** PostgreSQL (RPC), TanStack Start (Server function), React + Radix UI AlertDialog + Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-07-super-admin-purge-test-data-design.md`

---

### Task 1: Migration — `super_admin_purge_restaurant_test_data` RPC

**Files:**
- Create: `supabase/migrations/20260907130000_super_admin_purge_test_data.sql`
- Create: `tests/super-admin-purge-test-data-migration.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260907130000_super_admin_purge_test_data.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("super admin purge test data migration", () => {
  it("creates super_admin_purge_restaurant_test_data function", () => {
    expect(sql).toContain("create or replace function public.super_admin_purge_restaurant_test_data");
  });
  it("deletes from all transient tables", () => {
    expect(sql).toContain("delete from public.table_occupancy_state");
    expect(sql).toContain("delete from public.occupancy_transitions");
    expect(sql).toContain("delete from public.table_escort_intents");
    expect(sql).toContain("delete from public.qr_scan_events");
    expect(sql).toContain("delete from public.pending_qr_scans");
    expect(sql).toContain("delete from public.qr_scan_debounce");
    expect(sql).toContain("delete from public.role_session_tokens");
    expect(sql).toContain("delete from public.role_session_pin_attempts");
    expect(sql).toContain("delete from public.crew_role_sessions");
    expect(sql).toContain("delete from public.crew_session_tokens");
    expect(sql).toContain("delete from public.crew_sessions");
    expect(sql).toContain("delete from public.playback_events");
    expect(sql).toContain("delete from public.crew_messages");
    expect(sql).toContain("delete from public.remote_commands");
    expect(sql).toContain("delete from public.operational_errors");
  });
  it("does not delete from master tables", () => {
    expect(sql).not.toContain("delete from public.restaurants");
    expect(sql).not.toContain("delete from public.manager_accounts");
    expect(sql).not.toContain("delete from public.audio_manifests");
    expect(sql).not.toContain("delete from public.qr_table_tokens");
    expect(sql).not.toContain("delete from public.qr_export_batches");
  });
  it("bumps table occupancy revision for realtime client refresh", () => {
    expect(sql).toContain("bump_table_occupancy_revision");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/super-admin-purge-test-data-migration.test.ts`
Expected: FAIL (File not found)

- [ ] **Step 3: Write SQL migration file**

Create `supabase/migrations/20260907130000_super_admin_purge_test_data.sql`:
```sql
-- Super Admin: Safe purge of operational and testing data for a specific restaurant.
-- Preserves master data: restaurants, manager_accounts, audio_manifests, qr_table_tokens.

create or replace function public.super_admin_purge_restaurant_test_data(
  p_restaurant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_rev bigint;
begin
  select exists(select 1 from public.restaurants where id = p_restaurant_id) into v_exists;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'RESTAURANT_NOT_FOUND');
  end if;

  -- 1. Table occupancy & status
  delete from public.table_occupancy_state where restaurant_id = p_restaurant_id;
  delete from public.occupancy_transitions where restaurant_id = p_restaurant_id;
  delete from public.table_escort_intents where restaurant_id = p_restaurant_id;
  delete from public.qr_scan_events where restaurant_id = p_restaurant_id;
  delete from public.pending_qr_scans where restaurant_id = p_restaurant_id;
  delete from public.qr_scan_debounce where restaurant_id = p_restaurant_id;

  -- 2. Crew sessions & tokens (all roles)
  delete from public.role_session_tokens
  where role_session_id in (
    select id from public.crew_role_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.role_session_pin_attempts where restaurant_id = p_restaurant_id;
  delete from public.crew_role_sessions where restaurant_id = p_restaurant_id;

  -- 3. Soundboard legacy crew sessions & tokens
  delete from public.crew_session_tokens
  where crew_session_id in (
    select id from public.crew_sessions where restaurant_id = p_restaurant_id
  );
  delete from public.crew_sessions where restaurant_id = p_restaurant_id;

  -- 4. Activity, playback, errors, and messages
  delete from public.playback_events where restaurant_id = p_restaurant_id;
  delete from public.crew_messages where restaurant_id = p_restaurant_id;
  delete from public.remote_commands where restaurant_id = p_restaurant_id;
  delete from public.operational_errors where restaurant_id = p_restaurant_id;

  -- 5. Realtime revision bump (so Kasir/Satgas/Manager see instant empty state)
  v_rev := public.bump_table_occupancy_revision(p_restaurant_id);

  return jsonb_build_object('ok', true, 'revision', v_rev);
end;
$$;

revoke all on function public.super_admin_purge_restaurant_test_data(uuid) from public, anon;
grant execute on function public.super_admin_purge_restaurant_test_data(uuid) to authenticated, service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/super-admin-purge-test-data-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Apply migration to Supabase prod**

Apply using `supabase_apply_migration`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260907130000_super_admin_purge_test_data.sql tests/super-admin-purge-test-data-migration.test.ts
git commit -m "feat(db): add super_admin_purge_restaurant_test_data RPC"
```

---

### Task 2: Server Function — `purgeRestaurantTestData`

**Files:**
- Modify: `src/lib/admin-restaurants.server.ts`
- Create: `tests/super-admin-purge-server.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { purgeRestaurantTestDataCore } from "../src/lib/admin-restaurants.server";

describe("purgeRestaurantTestDataCore", () => {
  it("invokes RPC and returns ok", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      if (fn === "super_admin_purge_restaurant_test_data") {
        return { data: { ok: true, revision: 12 }, error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    };
    const res = await purgeRestaurantTestDataCore({ restaurantId: "00000000-0000-0000-0000-000000000001" }, rpc);
    expect(res).toEqual({ ok: true, revision: 12 });
  });

  it("handles RPC error gracefully", async () => {
    const rpc = async () => ({ data: null, error: { message: "database error" } });
    const res = await purgeRestaurantTestDataCore({ restaurantId: "00000000-0000-0000-0000-000000000001" }, rpc);
    expect(res).toEqual({ error: "Gagal mereset data testing." });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/super-admin-purge-server.test.ts`
Expected: FAIL (purgeRestaurantTestDataCore not exported)

- [ ] **Step 3: Add server function to `src/lib/admin-restaurants.server.ts`**

Add core function and TanStack Start `createServerFn`:
```ts
export async function purgeRestaurantTestDataCore(
  data: { restaurantId: string },
  rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: any; error: any }>,
) {
  try {
    const { data: result, error } = await rpc("super_admin_purge_restaurant_test_data", {
      p_restaurant_id: data.restaurantId,
    });
    if (error || !result?.ok) {
      return { error: "Gagal mereset data testing." };
    }
    return { ok: true as const, revision: result.revision };
  } catch {
    return { error: "Gagal mereset data testing." };
  }
}

export const purgeRestaurantTestData = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Gagal mereset data testing." };
    return purgeRestaurantTestDataCore({ restaurantId: data.restaurantId }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/super-admin-purge-server.test.ts`
Expected: PASS

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write src/lib/admin-restaurants.server.ts tests/super-admin-purge-server.test.ts
git add src/lib/admin-restaurants.server.ts tests/super-admin-purge-server.test.ts
git commit -m "feat: add purgeRestaurantTestData server function"
```

---

### Task 3: UI — Danger Zone Reset Card in `/super-admin/restaurants/$id.tsx`

**Files:**
- Modify: `src/routes/super-admin/restaurants/$id.tsx`
- Create: `tests/super-admin-purge-ui.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ui = readFileSync(
  new URL("../src/routes/super-admin/restaurants/$id.tsx", import.meta.url),
  "utf8",
);

describe("super admin restaurant detail purge UI", () => {
  it("imports purgeRestaurantTestData", () => {
    expect(ui).toContain("purgeRestaurantTestData");
  });
  it("has Danger Zone card with clear safety explanation", () => {
    expect(ui).toContain("Reset Data Testing & Operasional");
    expect(ui).toContain("Ketik 'RESET'");
  });
  it("requires RESET confirmation text", () => {
    expect(ui).toContain('purgeConfirmation !== "RESET"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/super-admin-purge-ui.test.ts`
Expected: FAIL

- [ ] **Step 3: Modify `src/routes/super-admin/restaurants/$id.tsx`**

1. Import `purgeRestaurantTestData`.
2. Add state `const [purgeConfirmation, setPurgeConfirmation] = useState(""); const [purging, setPurging] = useState(false); const [purgeError, setPurgeError] = useState<string | null>(null); const [purgeSuccess, setPurgeSuccess] = useState(false);`
3. Add handler `async function executePurge()`.
4. Render Danger Zone `TaCard` at bottom with description of safe deletion vs preserved data, and AlertDialog requiring `RESET`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/super-admin-purge-ui.test.ts`
Expected: PASS

- [ ] **Step 5: Prettier + commit**

```bash
npx prettier --write src/routes/super-admin/restaurants/\$id.tsx tests/super-admin-purge-ui.test.ts
git add src/routes/super-admin/restaurants/\$id.tsx tests/super-admin-purge-ui.test.ts
git commit -m "feat: add safe test data purge card and confirmation dialog in Super Admin"
```

---

### Task 4: Full Quality Gate Verification

- [ ] **Step 1: Run `npm run verify`**
- [ ] **Step 2: Check test count and exit code**
- [ ] **Step 3: Report results and ask for push**
