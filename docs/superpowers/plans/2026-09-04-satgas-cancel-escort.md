# Satgas Cancel Escort Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any Satgas cancel an unresolved escort intent (including orphans from dead sessions) by tapping a yellow table and confirming, so stuck-yellow tables return to green.

**Architecture:** New security-definer RPC `cancel_escort_intent` sets `resolved = true` and broadcasts a `kind`-less invalidate (refetch, no toast). A client wrapper mirrors `confirmEscortIntent`. The Satgas grid/list stop disabling escorted tables and route an escorted tap to a new "Batalkan Escort?" dialog.

**Tech Stack:** TypeScript (ESM, named imports), TanStack Start server fns, React 19, Vitest (source-contract + injected-rpc unit tests), Supabase Postgres security-definer RPCs + `realtime.send`.

**Binding rules (repo AGENTS.md):** strict TDD, `npm run verify` exit 0 before commit+push, never edit an applied migration, distinguish repo migration filename from Supabase ledger version.

Spec: `docs/superpowers/specs/2026-09-04-satgas-cancel-escort-design.md`

---

## File Structure

- Create `supabase/migrations/20260904100000_cancel_escort_intent.sql` — the new RPC.
- Modify `src/lib/table-occupancy.server.ts` — `cancelEscortIntent` server fn + core.
- Modify `src/routes/satgas/index.tsx` — tappable escorted tables + cancel dialog + mutation.
- Tests: new `tests/cancel-escort-migration.test.ts`, `tests/cancel-escort-client.test.ts`; edit `tests/satgas-route.test.ts` (3 assertions that the feature intentionally changes).

---

## Task 1: Migration — `cancel_escort_intent` RPC

**Files:**
- Create: `supabase/migrations/20260904100000_cancel_escort_intent.sql`
- Test: `tests/cancel-escort-migration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cancel-escort-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const url = new URL(
  "../supabase/migrations/20260904100000_cancel_escort_intent.sql",
  import.meta.url,
);
const source = () => readFileSync(url, "utf8").toLowerCase();

describe("cancel_escort_intent migration", () => {
  it("defines the rpc and resolves (not deletes) the intent", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.cancel_escort_intent(");
    expect(sql).toContain("set resolved = true");
    expect(sql).not.toContain("delete from public.table_escort_intents");
  });

  it("allows any satgas at the restaurant (no actor_session_id restriction)", () => {
    const sql = source();
    expect(sql).toContain("rst.role = 'satgas'");
    expect(sql).toContain("restaurant_id = v_session.restaurant_id");
    expect(sql).not.toContain("actor_session_id = v_session.role_session_id");
  });

  it("bumps revision and broadcasts a kind-less invalidate (refetch, no toast)", () => {
    const sql = source();
    expect(sql).toContain("bump_table_occupancy_revision");
    expect(sql).toMatch(/perform realtime\.send\([\s\S]*?'invalidate'[\s\S]*?,\s*true\s*\)/);
    expect(sql).not.toContain("'kind'");
  });

  it("grants execute to authenticated only", () => {
    const sql = source();
    expect(sql).toMatch(
      /revoke all on function public\.cancel_escort_intent\(uuid, text\) from public, anon, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.cancel_escort_intent\(uuid, text\) to authenticated/,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cancel-escort-migration.test.ts`
Expected: FAIL — ENOENT on the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260904100000_cancel_escort_intent.sql`:
```sql
-- Let any Satgas cancel an unresolved escort intent at their restaurant, so an
-- orphaned intent (creating session gone) no longer locks a table yellow.
-- Marks resolved (audit preserved); occupancy status is untouched. Broadcasts a
-- kind-less invalidate so every crew grid drops the yellow on refetch, with no
-- toast (a cancel is not a table status change).

create or replace function public.cancel_escort_intent(
  p_intent_id uuid,
  p_session_token text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session record;
  v_intent record;
  v_revision bigint;
begin
  select rst.* into v_session
  from public.role_session_tokens rst
  join public.restaurants r on r.id = rst.restaurant_id
  where rst.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    and rst.role = 'satgas'
    and rst.expires_at > now()
    and r.is_active
    and rst.code_version = r.code_version;
  if v_session is null then raise exception 'INVALID_SESSION'; end if;

  select * into v_intent
  from public.table_escort_intents
  where id = p_intent_id
    and restaurant_id = v_session.restaurant_id
    and resolved = false;
  if v_intent is null then return false; end if;

  update public.table_escort_intents
  set resolved = true
  where id = v_intent.id;

  v_revision := public.bump_table_occupancy_revision(v_intent.restaurant_id);
  perform realtime.send(
    jsonb_build_object('table_number', v_intent.table_number, 'revision', v_revision),
    'invalidate',
    'table-occupancy:' || v_intent.restaurant_id::text,
    true
  );
  return true;
end;
$$;

revoke all on function public.cancel_escort_intent(uuid, text) from public, anon, service_role;
grant execute on function public.cancel_escort_intent(uuid, text) to authenticated;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cancel-escort-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904100000_cancel_escort_intent.sql tests/cancel-escort-migration.test.ts
git commit -m "feat(db): add cancel_escort_intent RPC (any satgas, resolves intent)"
```

---

## Task 2: Client wrapper `cancelEscortIntent`

**Files:**
- Modify: `src/lib/table-occupancy.server.ts` (after the `confirmEscortIntent` block, ~line 213)
- Test: `tests/cancel-escort-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cancel-escort-client.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { cancelEscortIntentCore } from "../src/lib/table-occupancy.server";

const INPUT = { intentId: "7359da62-dc98-4a81-9a0f-56da46f32f70", sessionToken: "tok" };

describe("cancelEscortIntentCore", () => {
  it("returns ok with the RPC's boolean", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await cancelEscortIntentCore(INPUT, rpc)).toEqual({ ok: true, cancelled: true });
    expect(rpc).toHaveBeenCalledWith("cancel_escort_intent", {
      p_intent_id: INPUT.intentId,
      p_session_token: INPUT.sessionToken,
    });
  });

  it("treats an already-resolved intent as ok (idempotent)", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await cancelEscortIntentCore(INPUT, rpc)).toEqual({ ok: true, cancelled: false });
  });

  it("maps INVALID_SESSION and never leaks the raw error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "INVALID_SESSION detail" } }));
    const result = await cancelEscortIntentCore(INPUT, rpc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("detail");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/cancel-escort-client.test.ts`
Expected: FAIL — `cancelEscortIntentCore` not exported.

- [ ] **Step 3: Write the implementation**

In `src/lib/table-occupancy.server.ts`, insert after the `confirmEscortIntent` server-fn (after line 213):
```ts
// ---------------------------------------------------------------------------
// cancel_escort_intent
// ---------------------------------------------------------------------------

export const cancelEscortIntentInputSchema = z.object({
  intentId: z.string().uuid(),
  sessionToken: z.string().min(1),
  accessToken: z.string().min(1),
});
type CancelEscortIntentRpcInput = Omit<
  z.infer<typeof cancelEscortIntentInputSchema>,
  "accessToken"
>;

const CANCEL_ESCORT_INTENT_ERRORS = ["INVALID_SESSION"] as const;
export type CancelEscortIntentResult =
  | { ok: true; cancelled: boolean }
  | {
      ok: false;
      code: (typeof CANCEL_ESCORT_INTENT_ERRORS)[number] | "UNAVAILABLE";
      message: string;
    };

export async function cancelEscortIntentCore(
  data: CancelEscortIntentRpcInput,
  rpc: RpcCaller,
): Promise<CancelEscortIntentResult> {
  try {
    const { data: cancelled, error } = await rpc("cancel_escort_intent", {
      p_intent_id: data.intentId,
      p_session_token: data.sessionToken,
    });
    if (error) return mapError(error.message, CANCEL_ESCORT_INTENT_ERRORS);
    return { ok: true, cancelled: Boolean(cancelled) };
  } catch {
    return unavailable();
  }
}

export const cancelEscortIntent = createServerFn({ method: "POST" })
  .validator(cancelEscortIntentInputSchema)
  .handler(async ({ data }): Promise<CancelEscortIntentResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return unavailable();
    const { accessToken: _accessToken, ...rpcData } = data;
    return cancelEscortIntentCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/cancel-escort-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/table-occupancy.server.ts tests/cancel-escort-client.test.ts
git commit -m "feat: add cancelEscortIntent client wrapper mirroring confirm"
```

---

## Task 3: Satgas UI — tappable escorted tables + cancel dialog

**Files:**
- Modify: `src/routes/satgas/index.tsx`
- Test: `tests/satgas-route.test.ts` (update 3 assertions) + new `tests/satgas-cancel-escort.test.ts`

- [ ] **Step 1: Update the existing tests that the feature changes (MERAH)**

In `tests/satgas-route.test.ts`:

(a) The access-token count (line 67) becomes 4 (cancel adds a call site):
```ts
      ).toBe(4);
```

(b) Replace the "only opens the escort dialog from the empty-table tap handler" test (lines 123-129) with:
```ts
  it("routes an empty-table tap to escort and an escorted-table tap to cancel", () => {
    const text = source();
    expect(text).toContain("onSelectEmptyTable(tableNumber)");
    expect(text).toContain("onSelectEscortedTable(");
    expect(
      (text.match(/onSelectEmptyTable\(tableNumber\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });
```

(c) Replace the "no dedicated cancel action" test (lines 182-189) with:
```ts
  it("adds a cancel-escort action while keeping QR-scan auto-clear of the waitlist", () => {
    const text = source();
    expect(text).toContain("cancelEscortIntent(");
    expect(text).toContain("removeEscortWaitEntry(");
    expect(text).toContain("snapshot.data");
  });
```

- [ ] **Step 2: Write the new failing test**

Create `tests/satgas-cancel-escort.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/satgas/index.tsx", import.meta.url), "utf8");

describe("Satgas cancel-escort UI", () => {
  it("shows a Batalkan Escort confirmation dialog", () => {
    const text = source();
    expect(text).toContain("Batalkan Escort untuk Meja");
    expect(text).toContain("cancelMutation.mutate");
  });
  it("no longer disables escorted tables (occupied/pending only)", () => {
    const text = source();
    expect(text).toContain("disabled={occupied || isPending}");
    expect(text).toContain("aria-disabled={occupied || isPending}");
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run tests/satgas-route.test.ts tests/satgas-cancel-escort.test.ts`
Expected: FAIL (cancel not wired; escorted still disabled).

- [ ] **Step 4: Implement**

In `src/routes/satgas/index.tsx`:

Add the import (extend the existing `@/lib/table-occupancy.server` import list):
```ts
import {
  cancelEscortIntent,
  confirmEscortIntent,
  createEscortIntent,
  getTableOccupancySnapshot,
  type TableOccupancyRow,
} from "@/lib/table-occupancy.server";
```

Add state next to `escortTable` (after line 84):
```ts
  const [cancelTarget, setCancelTarget] = useState<{
    tableNumber: number;
    intentId: string;
  } | null>(null);
```

Add a `cancelMutation` after `confirmMutation` (after line 281):
```ts
  const cancelMutation = useMutation({
    mutationFn: async (target: { tableNumber: number; intentId: string }) => {
      const result = await cancelEscortIntent({
        data: {
          intentId: target.intentId,
          sessionToken: identity!.roleSessionToken,
          accessToken: await getLiveAccessToken(getSupabaseBrowserClient(), identity!.accessToken),
        },
      });
      return { result, target };
    },
    onSuccess: ({ result, target }) => {
      if (!result.ok) {
        setActionError(result.message);
        return;
      }
      setActionError("");
      setWaitlist(
        removeEscortWaitEntry(browserSessionStorage(), identity!.roleSessionId, target.intentId),
      );
      void queryClient.invalidateQueries({ queryKey: snapshotQueryKey(restaurantId) });
    },
    onError: () => setActionError("Gagal membatalkan escort. Coba lagi."),
  });
```

Update the `TableGrid` and `TableList` usages (lines 374-387) to pass the new handler:
```tsx
          <TableGrid
            tables={tables}
            escortedTableNumbers={escortedTableNumbers}
            pendingTable={processingTable}
            onSelectEmptyTable={(tableNumber) => setEscortTable(tableNumber)}
            onSelectEscortedTable={(tableNumber, intentId) => setCancelTarget({ tableNumber, intentId })}
          />
```
```tsx
          <TableList
            tables={tables}
            escortedTableNumbers={escortedTableNumbers}
            pendingTable={processingTable}
            onSelectEmptyTable={(tableNumber) => setEscortTable(tableNumber)}
            onSelectEscortedTable={(tableNumber, intentId) => setCancelTarget({ tableNumber, intentId })}
          />
```

Add the cancel `AlertDialog` after the existing escort dialog (before `</OwnerPage>`, ~line 429):
```tsx
      <AlertDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan Escort untuk Meja {cancelTarget?.tableNumber}?</AlertDialogTitle>
            <AlertDialogDescription>
              Meja akan kembali berstatus kosong dan bisa di-escort lagi.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className={crewSecondaryButtonClass} onClick={() => setCancelTarget(null)}>
              Tidak
            </AlertDialogCancel>
            <AlertDialogAction
              className={crewPrimaryButtonClass}
              onClick={() => {
                if (cancelTarget !== null) cancelMutation.mutate(cancelTarget);
                setCancelTarget(null);
              }}
            >
              Ya, Batalkan
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
```

Update `TableGrid` (function at line 434): add the prop, stop disabling escorted, branch the click.
```tsx
function TableGrid({
  tables,
  escortedTableNumbers,
  pendingTable,
  onSelectEmptyTable,
  onSelectEscortedTable,
}: {
  tables: TableOccupancyRow[];
  escortedTableNumbers: Set<number>;
  pendingTable: number | null;
  onSelectEmptyTable: (tableNumber: number) => void;
  onSelectEscortedTable: (tableNumber: number, intentId: string) => void;
}) {
```
Inside the map, after `const isPending = ...`, add:
```tsx
        const escortIntentId = tables.find((t) => t.tableNumber === tableNumber)?.escortIntentId ?? null;
```
Change the button's disabled/aria/onClick:
```tsx
            aria-disabled={occupied || isPending}
            disabled={occupied || isPending}
            onClick={() =>
              escorted && escortIntentId
                ? onSelectEscortedTable(tableNumber, escortIntentId)
                : onSelectEmptyTable(tableNumber)
            }
```

Apply the identical prop + `escortIntentId` + disabled/onClick changes to `TableList` (function at line 483).

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run tests/satgas-route.test.ts tests/satgas-cancel-escort.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/satgas/index.tsx tests/satgas-route.test.ts tests/satgas-cancel-escort.test.ts
git commit -m "feat(ui): satgas can tap a yellow table to cancel its escort"
```

---

## Task 4: Full gate, apply migration, smoke, push, deploy

**Files:** none new.

- [ ] **Step 1: Full quality gate**

Run: `npm run verify`
Expected: exit 0. If lint flags CRLF, `npx prettier --write` the touched files and re-run.

- [ ] **Step 2: Apply the migration to the Supabase target**

Use Supabase MCP `apply_migration` (name `cancel_escort_intent`) with the exact SQL from Task 1 Step 3. Record the ledger version. Do not re-run if present.

- [ ] **Step 3: Read-back + transactional smoke (no production side effects)**

Run via `supabase_execute_sql`:
```sql
BEGIN;
-- create then cancel an escort intent for a real satgas session is not
-- available here, so verify the RPC exists, is authenticated-only, and runs:
SELECT has_function_privilege('authenticated','public.cancel_escort_intent(uuid,text)','execute') AS auth_can,
       has_function_privilege('anon','public.cancel_escort_intent(uuid,text)','execute') AS anon_can;
ROLLBACK;
```
Expected: `auth_can=true`, `anon_can=false`.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Verify CI + Vercel**

Run: `gh api repos/marko1kiro/table-talker-global/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'`
Expected: `db-reset: completed success`.

Run: `vercel ls lihat-meja --json`; confirm the new SHA reaches `state: READY`, `target: production`.

- [ ] **Step 6: Report + hand physical test to user**

Tell the user: log in as Satgas, tap a stuck yellow table -> "Batalkan Escort untuk Meja N?" -> Ya -> table turns green. Note the user is clearing the 8 existing CKRBUL orphans manually.
