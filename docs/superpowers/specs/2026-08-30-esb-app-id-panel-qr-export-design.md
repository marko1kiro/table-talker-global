# ESB App ID Panel + QR Link Export — Design Summary (Handoff #3)

> **Status: APPROVED BY USER, ZERO CODE WRITTEN.** This document did not
> exist as a formal spec file in the repo before this handoff — it is
> compiled here, for the first time, purely from the conversation record
> (see `01-FULL-CONVERSATION-NARRATIVE.md` PART E for the exact
> back-and-forth this distills). Unlike
> `2026-08-29-table-occupancy-tracking-design.md`, **this file has NOT been
> committed to the live repo** (`docs/superpowers/specs/`) — it exists only
> inside this handoff package. The new agent session should decide, with
> the user, whether to formally commit a version of this to
> `docs/superpowers/specs/2026-08-30-esb-app-id-panel-qr-export-design.md`
> before or while implementing it (recommended, to match this project's own
> established convention of spec-before-plan-before-code), or simply build
> from this file directly. Either is reasonable — just don't silently skip
> writing anything down; this file itself already discharges the
"don't lose context" requirement regardless of whether it's ever
> git-committed.

## 1. Why this exists (business context)

Task 7 (QR Interceptor, now fully closed — see
`02-CLOSED-TASKS-CONTEXT.md`) builds real ESB redirect URLs as:

```
https://esborder.qs.esb.co.id/APP/{esb_app_id}/order?mode=dinein&tableNumber={n}
```

`esb_app_id` is a nullable `text` column added on `restaurants` back in
Task 5's migration (`20260829010000_table_occupancy_schema.sql`). At the
time Task 7 was completed, **no restaurant had a real value in this
column** — Task 7's own "Open items carried forward" section explicitly
flagged this as still-missing operational data (see the plan file,
Task 7, and `01-FULL-CONVERSATION-NARRATIVE.md` PART D).

Between Task 7's completion and this handoff, the user:
1. Supplied the real ESB App ID for all 9 pilot restaurants (see §4 below).
2. Asked how these values would actually get into the `esb_app_id` column,
   since there was (at the time) no admin UI for it at all — only two
   options existed: (A) build a proper Super Admin panel, or (B) a
   one-off manual SQL update.
3. Chose **Option A explicitly**, quoted verbatim in the narrative:
   > "gw gamau ada task yang 'setengah beres'... gw pilih Opsi A. buatin
   > panel khusus di super-admin, untuk ESB App ID. nah gw mau hasil
   > generate link meja untuk qr itu bisa di export ke .xlsx atau csv."
4. Separately asked for a way to **generate and export the actual QR
   redirect links** for all 100 tables of a chosen restaurant, so
   restaurant managers can hand these off to whoever prints/replaces the
   physical QR codes on each table (recall: QR image
   generation/printing itself remains explicitly out of scope for this
   app — see spec `2026-08-29-...`'s Non-Goals — this export only
   produces the **URLs/text**, not QR barcode images).

This is therefore **two closely related but separable pieces of UI**:
- **ESB App ID Panel**: lets a Super Admin view/set a restaurant's
  `esb_app_id`.
- **QR Link Export**: lets a Super Admin pick a restaurant, generate all
  100 `/r/{restaurantId}/t/{n}` interceptor URLs (or, if preferred, the
  direct ESB URLs — see the sequencing note in §6), and download them as
  `.xlsx` or `.csv`.

Both are Super Admin-only surfaces (existing `/super-admin` shell,
existing `requireSuperAdmin()`/`requireRecentSuperAdmin()` two-tier auth
from `src/lib/auth.server.ts` — see `reference_files/lib/auth.server.ts`).

## 2. The 5 approved design decisions (verbatim answers)

These were asked by the assistant as explicit numbered questions and
answered one-by-one by the user. All 5 are final and approved — do not
re-ask.

1. **Table count for QR export: fixed range 1–100, always** (option (a)
   of the 2 offered). This matches the existing, unrelated
   `TABLE_COUNT = 100` constant (`src/lib/remote-audio-domain.ts`,
   re-exported via `src/lib/audio.ts`) — reuse that constant, do not
   hardcode `100` again or make it configurable per restaurant. Every
   restaurant gets exactly 100 rows in the export, regardless of how many
   tables it physically has (this mirrors the existing app-wide
   assumption that soundboard/audio also always provisions for 100
   tables).

2. **Domain in exported links: user-editable in the export UI, NOT
   persisted to any database column, defaulting to `qr.xdirga.xyz`**
   (option (b) of the 2 offered). Concretely: the export UI should show a
   text input (pre-filled with `https://qr.xdirga.xyz`, or whatever the
   current interceptor domain is once Open Decision 2 from the original
   spec is finally resolved) that the Super Admin can edit before
   generating the file, but this value is never written to `restaurants`
   or any other table — it only affects the URLs baked into that one
   export run. This deliberately keeps the (still-temporary,
   per Task 7 Step 5 / Open Decision 2) interceptor domain from leaking
   into persisted state prematurely.

3. **Auth level for editing `esb_app_id`: light auth only**
   (`requireSuperAdmin()`, i.e. the plain "am I logged into
   `/super-admin` at all" check) — explicitly **not**
   `requireRecentSuperAdmin()` (the heavier, password-reconfirmation,
   5-minute-reauth-window check used by `changeRestaurantCode`/
   `deactivateRestaurant` for destructive/credential actions). The user's
   reasoning (paraphrased from the conversation): `esb_app_id` is
   configuration data, not a security credential like the restaurant's
   login code — it doesn't need the heavier re-auth ceremony.

4. **Export format: two separate, distinct buttons** — one labeled for
   `.xlsx`, one labeled for `.csv` — **not** a single combined
   "export"-then-pick-format flow. Each button triggers its own
   generation+download directly.

5. **Restaurant selection for export: a dropdown selector**, listing all
   9 (or however many exist by the time this is built) restaurants by
   `display_name`, each internally mapped to its own `esb_app_id`/`id`.
   Reuse `listOwnerRestaurants` (`src/lib/owner-restaurants.server.ts`,
   RPC `owner_restaurant_list`) as the data source for this dropdown —
   **but note this RPC currently does NOT return `esb_app_id`** (verified
   by reading `supabase/migrations/20260824002000_owner_restaurant_catalog.sql`
   and `20260829000000_remove_remote_command_heartbeat.sql` lines
   195-240 in this session — neither definition includes that column). Two
   implementation choices, both viable, neither yet decided:
   - (a) Modify `owner_restaurant_list()`'s RPC definition (new migration)
     to also return `esb_app_id`.
   - (b) Skip the RPC for this one field and do a direct
     `getServiceClient().from("restaurants").select("id, display_name,
     esb_app_id")` read in a new dedicated server function — simpler,
     since service-role already has unrestricted read access to
     `restaurants` (only `anon`/`authenticated` are revoked at the table
     level), and avoids touching a shared RPC other UI already depends on.
   The research done in this session leaned toward (b) as simpler and
   lower-risk, but this was **not put to the user for final confirmation**
   before this handoff was requested — flag it as a small open
   implementation choice at the start of this feature's work, don't
   silently pick (b) without at least a one-line confirmation.

## 3. Library choice for `.xlsx` generation — CONFIRMED

`write-excel-file@4.1.1` (npm), Node entry point `write-excel-file/node`.
Confirmed via `npm view write-excel-file readme` (run twice this session)
that it exposes both:

```js
import writeXlsxFile from "write-excel-file/node";
// file-based:
await writeXlsxFile(sheetData, { filePath: "/path/to/file.xlsx" });
// buffer-based (the one we need for a Vercel serverless response):
const buffer = await writeXlsxFile(sheetData).buffer; // or however the
// exact buffer accessor is named in the installed version — re-check the
// README once installed, this was read via `npm view`, not hands-on yet.
```

This supersedes earlier undecided candidates:
- `xlsx` (SheetJS) — 7.5MB unpacked, 7 dependencies. Rejected as
  heavier than needed.
- `exceljs` — never actually inspected in this session (no npm view was
  run on it); not chosen, just never seriously investigated once
  `write-excel-file` looked adequate.

`write-excel-file` has exactly **1 dependency** (`fflate`), ~1.8MB
unpacked. **Not yet installed** — `package.json`/`package-lock.json`
(see `reference_files/package.json`, a point-in-time copy) confirm no
xlsx/exceljs/write-excel-file/csv library is present yet in this repo as
of this handoff. Installing it (`npm install write-excel-file`) is the
first concrete step of implementation.

**CSV generation needs no new dependency** — plain string generation
(`table_number,url\n1,https://...\n2,https://...`) is sufficient; just
remember to handle any need for quoting/escaping if a domain or future
field ever contains a comma (unlikely for this exact export, but a cheap
defensive habit).

## 4. Real ESB App ID data for all 9 pilot restaurants

Supplied verbatim by the user, then cross-referenced by the assistant
against `scripts/provision-restaurants-and-audio.mjs`'s `RESTAURANTS`
array (see `reference_files/provision-restaurants-and-audio.mjs`, the
**already-fixed** copy — see §5 below) to map each ESB App ID to the
correct restaurant **code**. This mapping is the actual operational data
this whole feature exists to let a human enter once (via the new panel)
rather than ever being hardcoded into application code:

| Restaurant code | ESB App ID | Display name (from provisioning script) | Restaurant UUID (if known) |
|---|---|---|---|
| `BKSGOL` | `1084` | Mie Gacoan Golden City | — |
| `CKRBOS` | `1327` | Mie Gacoan Bosih Raya | `fa2dea0f-8c68-4c2f-bb72-17c34825c61e` |
| `CKRBUL` | `1294` | Mie Gacoan Kampung Bulu | `33916a05-7e95-42fa-bc3c-050bed2402c5` |
| `BKSBAN` | `1109` | Mie Gacoan Bantar Gebang Sétu | — |
| `BKSMUT` | `1205` | Mie Gacoan Cut Mutia | — |
| `CKRMAR` | `1239` | Mie Gacoan R.E. Martadinata | — |
| `CKRTHA` | `1060` | Mie Gacoan M.H. Thamrin | — |
| `CKRCIK` | `1284` | Mie Gacoan Cikoronjo Cibarusah | — |
| `CKRTAR` | `1129` | Mie Gacoan Tarum Barat | — (production-verified login, code was just rotated — see §5) |

**Do not guess/derive the missing UUIDs from this table** — the two UUIDs
shown were captured incidentally during earlier provisioning-script
cross-referencing, not from a fresh production query. When building the
panel, look up each restaurant's real `id` live via
`listOwnerRestaurants`/a direct query, never hardcode any UUID from this
table into new code.

**These 9 values are exactly what a Super Admin operator should type into
the new ESB App ID panel, once built, for each of the 9 restaurants.**
Nothing in the codebase can derive them — they come from ESB's own
back-office, external to this app.

## 5. The CKRTAM → CKRTAR blocker (context for why Tarum Barat's row needs care)

While cross-referencing the table in §4 against the provisioning script,
a blocker was found: the script had `code: "CKRTAM"` hardcoded for "Mie
Gacoan Tarum Barat", but the user's real list said `CKRTAR`. This was
paused and explicitly flagged to the user (per this project's standing
"STOP kalau kamu nemu Blocker" rule) rather than silently guessed at or
fixed. The user confirmed:
- `CKRTAR` is the correct/valid code; `CKRTAM` was simply wrong.
- The script had **already been run in production** with the wrong code
  — i.e., restaurant "Mie Gacoan Tarum Barat" was live with `CKRTAM` as
  its actual login code in the `restaurants` table.
- The user's explicit instruction: fix this via the **official "Ganti
  Kode" (credential rotation) flow** — `changeRestaurantCode` server
  function / `RestaurantCredentialDialog` `rotate` mode UI (see
  `reference_files/lib/admin-restaurants.server.ts` and
  `reference_files/components/RestaurantCredentialDialog.tsx`) — **not**
  a raw manual SQL edit against the live `code_hash`/`code_encrypted`
  columns.

**This is now fully resolved and closed** (see
`02-CLOSED-TASKS-CONTEXT.md`'s new entry): the repo-level bug was fixed at
the source (`scripts/provision-restaurants-and-audio.mjs` line 109,
`"CKRTAM"` → `"CKRTAR"`, commit `ba622ec`, already merged into `main` via
PR #11), and the user personally performed the production "Ganti Kode"
fix through the dashboard and **verified it via a successful login test**
using the new `CKRTAR` code. Nothing further is needed on this thread —
it's included here only so the ESB panel's Tarum Barat row (`CKRTAR` /
`1129`) is understood as already-correct, not a leftover inconsistency to
re-investigate.

## 6. Suggested implementation shape (research done, not yet built)

Two implementation-shape questions were resolved as **de-risked, either
is viable** during this session's research (see
`01-FULL-CONVERSATION-NARRATIVE.md` PART E for the full node_modules
source-tracing detail):

- **Raw API route vs. `createServerFn` for the xlsx/csv download
  endpoint**: both work. `getSession()`/`requireSuperAdmin()` is
  available inside a raw `createFileRoute(...).server.handlers.GET`
  route (traced through `@tanstack/start-server-core`'s
  `AsyncLocalStorage`-backed request context — the same
  `eventStorage.run(...)` wraps every request, whether it's a
  `createServerFn` call or a raw route). AND a `createServerFn` handler
  can return a raw binary `Response` directly (confirmed via
  `server-functions-handler.js`'s `unwrapped instanceof Response` branch,
  which tags it with the `X-TSS-Raw-Response` header and passes it
  through unmodified) — so a server function can itself stream back an
  `.xlsx`/`.csv` file with correct `Content-Type`/`Content-Disposition`
  headers, exactly like `src/lib/restaurant-audio.server.ts`'s existing
  `response()` helper builds a raw binary `Response` for audio downloads
  (see `reference_files/lib/restaurant-audio.server.ts`, partial copy,
  for that exact pattern).
- **Recommendation (not yet put to the user for final confirmation)**:
  follow the raw-API-route pattern (`src/routes/api/audio/$audioId.ts`
  is the cleanest existing template — see
  `reference_files/routes/api-audio-$audioId.ts`), e.g. a new route like
  `src/routes/api/super-admin/qr-export/$restaurantId.$format.ts` (or
  similar — exact path not decided), calling straight into a new
  `src/lib/qr-export.server.ts` that does
  `requireSuperAdmin()` → look up the restaurant's `esb_app_id`/
  `display_name` → build 100 rows → hand off to `write-excel-file` or
  the plain CSV string builder → return a `Response` with the right
  `Content-Type` (`application/vnd.openxmlformats-officedocument.
  spreadsheetml.sheet` for xlsx, `text/csv` for csv) and
  `Content-Disposition: attachment; filename=...`.

**Suggested new files (not yet created, names not yet finalized/approved
by the user — treat as a starting proposal only)**:
- `src/lib/esb-app-id.server.ts` — light-auth `createServerFn` pair:
  `getRestaurantEsbAppId` (GET) / `setRestaurantEsbAppId` (POST,
  `requireSuperAdmin()` only), following the exact
  `createServerFn`+`getServiceClient()` pattern of
  `reference_files/lib/admin-restaurants.server.ts`'s lighter-auth
  functions (`createRestaurant`, `viewRestaurantCode`) rather than its
  heavy-auth ones.
- `src/lib/qr-export.server.ts` — `buildQrExportRows(restaurantId,
  domain)` pure core (dependency-injected, following this codebase's
  Core-fn convention) + the xlsx/csv Response-building wrapper(s).
- UI: either a new field/section on
  `src/routes/super-admin/restaurants/$id.tsx` (see
  `reference_files/routes/` — note: this exact `$id.tsx` file was NOT
  copied into this handoff's `routes/` folder since its filename pattern
  with `$` caused tooling friction in a prior handoff; its **full content
  was read directly from the live repo this session** and is reproduced
  in `01-FULL-CONVERSATION-NARRATIVE.md` PART E's file-reading log — refer
  to the live repo file directly, it's simple enough (~184 lines) not to
  need a stale copy) — adding an "ESB App ID" input + save button next to
  the existing "Lihat Kode"/"Ganti Kode"/"Kelola Audio" buttons, plus two
  new "Export .xlsx" / "Export .csv" buttons and the editable-domain text
  input — OR a dedicated new route entirely
  (`src/routes/super-admin/esb-export.tsx` or similar) with its own
  restaurant dropdown. **Not decided — raise with the user before
  building**, since it changes where in the nav/IA this feature lives
  (the existing Super Admin nav is `Dashboard, Restoran, Audio, Riwayat,
  Error Log` — see `reference_files/routes/` note above and the live
  `src/routes/super-admin/route.tsx`, ~194 lines, not copied into this
  handoff's reference set but easy to re-read live).

## 7. TDD expectations

Follow this codebase's established convention exactly (see
`reference_files/tests/table-occupancy-rpc-contract.test.ts` and
`reference_files/tests/qr-interceptor.test.ts` as style templates): write
failing tests first for (a) the `esb_app_id` get/set server functions
(light-auth-only contract, value round-trips correctly, rejects
non-super-admin), (b) the export row-building pure core function (100
rows always, correct URL shape per row, domain substitution works), (c)
the xlsx/csv Response endpoints (correct `Content-Type`/
`Content-Disposition`, correct byte content for a small fixture case).
Run `npm run verify` before considering this feature done, exactly like
every other task in this project.
