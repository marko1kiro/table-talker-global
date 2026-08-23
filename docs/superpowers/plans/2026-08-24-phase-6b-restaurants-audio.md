# Phase 6B Restaurants And Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver tenant-scoped restaurant lifecycle/detail and complete table, announcement, custom audio catalog management.

**Architecture:** Build on 6A shell. Owner server functions use `requireSuperAdmin()` before service-role reads/mutations and return stable `{ ok: false, code, message }` expected failures. Extend existing versioned `mutate_catalog` path instead of adding browser state or a second catalog mechanism; upload retains presigned immutable R2 PUT, SHA-256 verification, and catalog mutation only after verified object exists.

**Tech Stack:** TanStack Start, TanStack Query, Zod, Supabase/PostgreSQL RPC, AWS S3/R2, Vitest source-contract and pure tests.

---

## Dependency Order

1. Requires 6A route shell and dashboard migration `20260824001000`.
2. Use migration `20260824002000`; it sorts after current `20260824000000` and cannot collide.
3. 6C consumes restaurant selector/detail activity. 6D consumes active restaurant and crew eligibility queries.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/owner-restaurants-domain.ts` | Pure custom ID, destructive confirmation, list/detail display helpers. |
| `src/lib/owner-restaurants.server.ts` | Owner list aggregates/detail; reuses credential actions. |
| `src/lib/manifest.server.ts` | Strict catalog action validators and stable results. |
| `src/routes/super-admin/restaurants/index.tsx` | Restaurant list/create/deactivate/credential UI. |
| `src/routes/super-admin/restaurants/$id.tsx` | Dedicated restaurant detail. |
| `src/routes/super-admin/audio.tsx` | Per-restaurant catalog selector, upload/edit/toggle/reorder/delete UI. |
| `supabase/migrations/20260824002000_owner_restaurant_catalog.sql` | Owner aggregate/detail RPC and catalog item constraints. |
| `tests/owner-restaurants-domain.test.ts` | Pure validation tests. |
| `tests/owner-restaurants-audio-source.test.ts` | Source-contract tests matching current node suite. |

### Task 1: Define restaurant and custom-audio contracts red

**Files:**
- Create: `tests/owner-restaurants-domain.test.ts`
- Create: `tests/owner-restaurants-audio-source.test.ts`

- [ ] **Step 1: Write failing pure tests**

```ts
import { expect, it } from "vitest";
import { confirmRestaurantName, validateCustomAudioId } from "../src/lib/owner-restaurants-domain";

it("requires exact destructive display-name confirmation", () => {
  expect(confirmRestaurantName("Resto Utama", "Resto Utama")).toBe(true);
  expect(confirmRestaurantName("Resto Utama", "resto utama")).toBe(false);
});
it("allows bounded custom IDs and rejects built-in namespaces", () => {
  expect(validateCustomAudioId("custom:promo-pagi")).toEqual({ ok: true, id: "custom:promo-pagi" });
  expect(validateCustomAudioId("table:9")).toEqual({ ok: false, code: "INVALID_AUDIO_ID" });
});
```

- [ ] **Step 2: Write failing source tests**

```ts
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
it("keeps owner server functions protected and catalog versioned", () => {
  expect(file("src/lib/owner-restaurants.server.ts")).toContain("requireSuperAdmin()");
  expect(file("src/lib/manifest.server.ts")).toContain('rpc("mutate_catalog"');
});
```

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/owner-restaurants-domain.test.ts tests/owner-restaurants-audio-source.test.ts`

Expected: FAIL resolving `owner-restaurants-domain` and missing `owner-restaurants.server.ts`.

### Task 2: Add bounded owner restaurant data and catalog constraints

**Files:**
- Create: `supabase/migrations/20260824002000_owner_restaurant_catalog.sql`
- Create: `src/lib/owner-restaurants-domain.ts`
- Create: `src/lib/owner-restaurants.server.ts`
- Modify: `src/lib/manifest.server.ts`

- [ ] **Step 1: Add owner aggregate RPC and item checks**

```sql
create or replace function public.owner_restaurant_rows(p_since timestamptz)
returns table(id uuid, display_name text, is_active boolean, catalog_version integer, online_devices bigint, plays_today bigint, latest_sync_failure timestamptz)
language sql security definer set search_path = public as $$
  select r.id, r.display_name, r.is_active, r.catalog_version,
    count(cs.id) filter (where cs.connection_state = 'connected' and cs.last_seen > now() - interval '30 seconds'),
    (select count(*) from public.playback_events pe where pe.restaurant_id = r.id and pe.event_timestamp >= date_trunc('day', now())),
    (select max(oe.occurred_at) from public.operational_errors oe where oe.restaurant_id = r.id and oe.stage = 'sync_cache' and oe.occurred_at >= p_since)
  from public.restaurants r left join public.crew_sessions cs on cs.restaurant_id = r.id
  group by r.id order by r.display_name;
$$;
alter table public.audio_manifests add constraint audio_manifests_owner_audio_id_check
check (audio_id ~ '^(table:([1-9]|[1-9][0-9]|100)|announcement:(seating|himbauan-barang-bawaan-pelanggan|outside-food|no-smoking|larangan-gabung-meja|jam-buka-resto)|custom:[a-z0-9_-]{1,80})$') not valid;
alter table public.audio_manifests validate constraint audio_manifests_owner_audio_id_check;
revoke all on function public.owner_restaurant_rows(timestamptz) from public, anon, authenticated;
grant execute on function public.owner_restaurant_rows(timestamptz) to service_role;
```

`sync_cache` is reused from existing `OPERATIONS_ERROR_CODES` in `src/lib/operational-errors.server.ts`; do not add or rename stages.

- [ ] **Step 2: Add pure validation**

```ts
export function confirmRestaurantName(expected: string, supplied: string) { return expected === supplied; }
export function validateCustomAudioId(value: string) {
  const id = value.trim();
  return /^custom:[a-z0-9_-]{1,80}$/.test(id)
    ? { ok: true as const, id }
    : { ok: false as const, code: "INVALID_AUDIO_ID" as const };
}
```

- [ ] **Step 3: Add `listOwnerRestaurants` and `getOwnerRestaurantDetail`**

Both server functions call `requireSuperAdmin()` first, accept only UUID restaurant IDs, select all detail records with `.eq("restaurant_id", data.restaurantId)`, limit recent playback/sync/error lists to 20, and return `NOT_FOUND`, `UNAVAILABLE`, or `OK`. Detail selects identity/active/catalog, current crew presence, current catalog mappings, and recent operational activity. It must never select `code_encrypted`, `code_hash`, or credential tokens.

- [ ] **Step 4: Tighten catalog mutation input and result shape**

Use exact discriminated result form:

```ts
type CatalogResult = { ok: true; version: number } | { ok: false; code: "INVALID_AUDIO_ID" | "NOT_FOUND" | "VERIFY_FAILED" | "UNAVAILABLE"; message: string };
```

Validate `table:*` and `announcement:*` as existing item namespaces; require `custom:*` through `validateCustomAudioId`; require nonempty label <= 200, category <= 60, MP3 metadata, boolean active, and integer ordering >= 0. Add `reorderManifestItem` calling existing `mutate_catalog` with `p_action: "upsert"` and copied verified metadata plus updated ordering. Every successful call returns RPC version.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/owner-restaurants-domain.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit data boundary**

```bash
git add supabase/migrations/20260824002000_owner_restaurant_catalog.sql src/lib/owner-restaurants-domain.ts src/lib/owner-restaurants.server.ts src/lib/manifest.server.ts tests/owner-restaurants-domain.test.ts
git commit -m "feat: add owner restaurant catalog data"
```

### Task 3: Build Resto list and detail routes

**Files:**
- Modify: `src/routes/super-admin/restaurants/index.tsx`
- Create: `src/routes/super-admin/restaurants/$id.tsx`
- Reuse: `src/components/RestaurantCredentialDialog.tsx`

- [ ] **Step 1: Run route source test before route implementation**

Append this route-only assertion first:

```ts
it("uses dedicated restaurant detail route", () => {
  expect(file("src/routes/super-admin/restaurants/$id.tsx")).toContain('createFileRoute("/super-admin/restaurants/$id")');
});
```

Run: `npx vitest run tests/owner-restaurants-audio-source.test.ts`

Expected: FAIL because restaurant detail route does not exist.

- [ ] **Step 2: Render server-authorized list fields**

Use `useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants })`. Render display name, active/inactive badge, online device count, catalog version, latest sync failure, and today plays. Create action opens existing credential dialog. View/rotate reuse dialog actions. Link each row with `<Link to="/super-admin/restaurants/$id" params={{ id: restaurant.id }}>`.

- [ ] **Step 3: Add exact destructive deactivate confirmation**

Use existing Radix `AlertDialog`: display selected name, controlled text input, disabled submit until `confirmRestaurantName(name, value)`, and existing `deactivateRestaurant` mutation. Display only result `message`; invalidate `["owner-restaurants"]` on `{ ok: true }`. Never inspect database error text.

- [ ] **Step 4: Render detail route**

```tsx
export const Route = createFileRoute("/super-admin/restaurants/$id")({ component: RestaurantDetail });
function RestaurantDetail() {
  const { id } = Route.useParams();
  const query = useQuery({ queryKey: ["owner-restaurant", id], queryFn: () => getOwnerRestaurantDetail({ data: { restaurantId: id } }) });
  if (query.isLoading) return <p role="status">Memuat resto...</p>;
  if (!query.data || !query.data.ok) return <p role="alert">Resto tidak tersedia.</p>;
  return <section><h1>{query.data.restaurant.display_name}</h1>{/* identity, credentials, crew, catalog, 20 recent playback/sync/error rows */}</section>;
}
```

- [ ] **Step 5: Run route build and restore generated tree**

Run: `npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: both commands exit `0`; generated tree equals HEAD and is unstaged.

- [ ] **Step 6: Run green source test and commit restaurant UI**

Run: `npx vitest run tests/owner-restaurants-audio-source.test.ts`

Expected: PASS.

```bash
git add src/routes/super-admin/restaurants/index.tsx src/routes/super-admin/restaurants/\$id.tsx tests/owner-restaurants-audio-source.test.ts
git commit -m "feat: add owner restaurant views"
```

### Task 4: Build complete Audio route

**Files:**
- Modify: `src/routes/super-admin/audio.tsx`
- Reuse: `src/lib/upload.server.ts`, `src/lib/manifest.server.ts`

- [ ] **Step 1: Write Audio route source assertion red**

Append this test before changing route:

```ts
it("uses existing MP3 SHA-256 upload flow", () => {
  expect(file("src/routes/super-admin/audio.tsx")).toContain('crypto.subtle.digest("SHA-256", buffer)');
});
```

Run: `npx vitest run tests/owner-restaurants-audio-source.test.ts`

Expected: FAIL because placeholder Audio route lacks digest call.

- [ ] **Step 2: Replace placeholder with selected-restaurant query boundary**

Use local `selectedRestaurantId` state, list owner-authorized restaurants, and query key `["manifest-items", selectedRestaurantId]`. No context/global store. Show loading, empty catalog, query error retry, and mutation failure states.

- [ ] **Step 3: Implement presigned MP3 upload safely**

```ts
const buffer = await file.arrayBuffer();
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const signed = await requestR2Upload({ data: { restaurantId, audioId, contentType: "audio/mpeg", byteSize: file.size, contentHash: hash } });
if (!signed.ok) return setError(signed.message);
const put = await fetch(signed.putUrl, { method: "PUT", headers: signed.headers, body: file });
if (!put.ok) return setError("UPLOAD_FAILED");
const result = await upsertManifestItem({ data: { restaurantId, audioId, label, category, r2Url: signed.url, contentHash: signed.hash, byteSize: signed.byteSize, ordering, active } });
```

When PUT or verification/catalog mutation fails, retain displayed previous query data and input error state; do not clear catalog. Server cleanup removes verified object on failed catalog write as current flow does.

- [ ] **Step 4: Cover all item types and mutations in UI**

Render `table:*`, `announcement:*`, and `custom:*` rows. Custom form includes ID, label, category, MP3, active toggle, ordering. Existing items permit metadata update, active/inactive, numeric reorder, and delete through explicit AlertDialog. Each success invalidates catalog and restaurant/dashboard keys; progress disables only affected mutation controls.

- [ ] **Step 5: Run focused and serial quality commands**

Run: `npx vitest run tests/owner-restaurants-domain.test.ts tests/owner-restaurants-audio-source.test.ts && npx tsc --noEmit && npm run lint && npm run build && git restore --source=HEAD -- src/routeTree.gen.ts`

Expected: all exit `0`; no React Testing Library command is added.

- [ ] **Step 6: Commit Audio UI**

```bash
git add src/routes/super-admin/audio.tsx src/lib/manifest.server.ts tests/owner-restaurants-audio-source.test.ts
git commit -m "feat: manage owner audio catalog"
```

## Plan Self-Review

- [x] Covers restaurant create/view/rotate/deactivate, list fields, dedicated detail, exact destructive confirmation, tenant-scoped queries, and no credential leakage.
- [x] Covers `table:*`, `announcement:*`, `custom:*`, custom constraints, MP3/hash/immutable R2 flow, upload failure preservation, activation, metadata, ordering, deletion, and version increments.
- [x] Uses current architecture and source/pure tests only; excludes unrelated audit changes and generated route tree commits.
