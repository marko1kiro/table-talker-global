# QR DOCX Export (server-side) — Design Spec

Date: 2026-09-03
Status: Approved (pending user review of this written spec)
Supersedes for the generate flow: dynamic CSV export artifact.

## Problem

The super-admin "Generate QR" flow currently produces two link-list artifacts
(XLSX + CSV) and stores them encrypted in R2. The crew needs a printable sheet
of QR **images** (one QR per table, labeled "Meja N") to stick on tables. A
standalone local tool (`Documents/LIME/qr-meja-generator`) already renders this
DOCX from an uploaded XLSX, but that upload→download round-trip does not fit the
server flow.

Goal: when "Generate QR" is pressed, the server builds the DOCX directly from the
same in-memory rows it already uses for the XLSX, stores it in R2 like every
other artifact, and the history table exposes two download buttons: **XLSX**
(list of links) and **DOCX** (list of QR images).

## Decisions (locked with user)

1. **CSV fate — replace.** The dynamic CSV artifact is no longer generated.
   History buttons become XLSX + DOCX. (Legacy compatibility builders
   `buildQrExportCsv` / `serveQrExport` that emit `/r/{id}/t/{n}` URLs are a
   separate, unused-by-this-flow path and are left untouched.)
2. **DOCX timing — at generation, stored in R2.** Built inside
   `generateQrBatchCore`, uploaded encrypted via `uploadPrivateR2Object`, key
   persisted per batch. Download just reads the stored object. Consistent with
   the existing XLSX-in-R2 model and the "history kept permanently for audit"
   principle.
3. **No 1..N completeness rule.** The DOCX renders exactly the tables in the
   batch (a `selected` subset like 1, 6, 30 is valid). Rows are sorted
   **ascending by table number** and labeled with their real table number. No
   XLSX is read; data already exists server-side as `{tableNumber, token}`.

## Architecture

Reuses the existing opaque-token batch pipeline. Only the second artifact
changes from CSV to DOCX, plus a new pure DOCX builder and one additive
migration.

```
generateQrExport (server fn)
  -> generateQrBatchCore
       normalize selection (unchanged)
       per attempt:
         batchId + tokens (unchanged)
         rows = [{tableNumber, token}]
         xlsx = buildDynamicQrExportXlsxBuffer(rows, domain)   (unchanged)
         docx = buildDynamicQrExportDocxBuffer(rows, domain)   (NEW, replaces csv)
         upload xlsx -> R2 (encrypted)
         upload docx -> R2 (encrypted)
         commit(batchId, ..., r2KeyXlsx, r2KeyDocx)            (csv arg -> docx)
         on failure: remove attempted keys, retry on 23505
  -> history: downloadBatch(id, "xlsx" | "docx")
       GET /api/super-admin/qr-export/{batchId}/{format}
         -> serveQrBatchDownload -> get_qr_export_key -> readPrivateQrExportObject
```

## Components & file changes

### 1. NEW `src/lib/qr-docx.server.ts`
- `buildDynamicQrExportDocxBuffer(rows: DynamicQrRow[], domain: string): Promise<Buffer>`
  - `DynamicQrRow = { tableNumber: number; token: string }` is imported as a
    **type-only** import from `qr-export.server.ts`
    (`import type { DynamicQrRow } from "./qr-export.server"`). Type-only imports
    are erased at compile time, so the runtime dependency stays one-way
    (`qr-export.server` -> `qr-docx.server`) with no cycle.
  - URL per QR: `` `${normalizedDomain(domain)}/q/${token}` `` — identical shape
    to the XLSX builder.
  - Sort a copy ascending by `tableNumber`.
  - Layout ported from the standalone tool: A4 portrait (11906x16838 twips),
    margins ~500/450, borderless `Table`, **4 cells per row**, each cell = QR
    `ImageRun` (PNG, 128x128 display from a 520px render, margin 2, error
    correction `M`) + centered bold `Meja {n}` label. `cantSplit` per row.
  - Uses `qrcode` (`QRCode.toBuffer(url, { type: "png", width: 520, margin: 2,
    errorCorrectionLevel: "M", color: {...} })`) and `docx`
    (`Document`, `Packer.toBuffer`, `Table`, `ImageRun`, ...).
  - Returns the DOCX `Buffer`.
- Pure helper `sortQrRowsAscending(rows)` exported for a cheap unit test.

### 2. `src/lib/qr-export.server.ts` (edit)
- `CommitQrBatchInput`: rename `r2KeyCsv` -> `r2KeyDocx`.
- `defaultCommitQrBatch`: send `p_r2_key_docx` instead of `p_r2_key_csv`.
- `generateQrBatchCore`: build `docx` via the new module, upload it, drop the
  dynamic CSV build/upload. `attemptedKeys` now `[xlsx, docx]`.
- `qrExportKey(restaurantId, batchId, format)`: the generate-side
  `QrExportFormat` becomes `"xlsx" | "docx"` (was `"xlsx" | "csv"`); only these
  two are ever produced for a new batch.
- `serveQrBatchDownload(batchId, format)`: keeps a wider accepted set
  `xlsx | docx | csv` (typed as its own union, not `QrExportFormat`) so
  pre-existing batches stay downloadable via direct URL even though no CSV button
  is shown; content-type map adds
  `docx -> application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  filename `qr-codes-{batchId}.{format}`.
- `buildDynamicQrExportCsv`: becomes unused by the flow. Remove it **only if** no
  test imports it (verify in the plan); otherwise leave as dead-but-exported.

### 3. `src/lib/r2.server.ts` (edit)
- `QR_EXPORT_KEY_PATTERN`: `qr-codes\.(xlsx|csv)` -> `qr-codes\.(xlsx|csv|docx)`.

### 4. NEW migration `supabase/migrations/20260903100000_add_qr_docx_export.sql`
Additive; original migrations untouched.
- `alter table public.qr_export_batches add column if not exists r2_key_docx text;`
  (`r2_key_csv` column is kept for old rows; new rows leave it null.)
- `create or replace function public.commit_qr_export_batch(...)` — **same 9-arg
  type signature** `(uuid, uuid, text, text, text, integer[], text[], text, text)`
  so it replaces in place; 9th param renamed `p_r2_key_docx`. Port the current
  deployed body verbatim, changing only:
  - validation `... or p_r2_key_xlsx is null or p_r2_key_docx is null then`
  - INSERT columns/values `r2_key_xlsx, r2_key_docx` (drop `r2_key_csv` from the
    insert so it stays null).
  - Keep the null-token remediation check
    `coalesce(cardinality(p_tokens), 0) <> cardinality(p_table_numbers)` and the
    token-format / restaurant-active guards exactly as deployed.
- `create or replace function public.get_qr_export_key(uuid, text)` — add
  `when 'docx' then b.r2_key_docx` and widen the guard to
  `p_format in ('xlsx', 'csv', 'docx')`.
- Re-`revoke`/`grant execute` for both functions to `service_role` only (matches
  existing ACL; CREATE OR REPLACE preserves ACL but restate for clarity).

### 5. `src/routes/super-admin/esb-export.tsx` (edit)
- `downloadBatch(batchId, format: "xlsx" | "docx")`.
- History row buttons: replace the CSV button with a **DOCX** button
  (`<Download /> DOCX`).
- Generate-panel copy: "QR lama baru dinonaktifkan setelah file XLSX dan DOCX
  baru berhasil disimpan." Success notice wording stays "kedua file berhasil
  dibuat".

### 6. `package.json` (edit)
- Add deps `docx`, `qrcode`; devDep `@types/qrcode`. No SheetJS `xlsx` needed
  (we never parse an uploaded workbook server-side).

## Data flow (happy path)
Super admin enters password, picks scope/tables, clicks Generate -> tokens minted
-> XLSX + DOCX built from the same rows -> both encrypted to R2 -> batch committed
(old tokens for those tables revoked, new tokens inserted) -> history shows the
new batch with XLSX + DOCX buttons -> clicking DOCX streams the stored encrypted
object, decrypted server-side.

## Error handling
- Any R2 upload failure before commit: delete every attempted key, then (on a
  token-collision `23505`) retry up to 3 attempts — unchanged semantics, now over
  `[xlsx, docx]`.
- DOCX build throws (e.g. a bad token/url): surfaces as the existing
  "Pembuatan file gagal. QR lama tetap aktif." path; nothing is committed, so old
  QR stay live.
- Download of a format whose stored key is null (e.g. csv on a new batch):
  `get_qr_export_key` returns null -> 404 "File tidak ditemukan." — unchanged.
- Route rejects unknown formats with 400.

## Testing (TDD)
- NEW `tests/qr-docx-domain.test.ts`: `sortQrRowsAscending` sorts [30,1,6] ->
  [1,6,30]; `buildDynamicQrExportDocxBuffer` returns a Buffer whose first two
  bytes are `PK` (valid zip/docx) for a subset incl. a single table and for
  [1,6,30]; does not throw on non-contiguous numbers.
- EDIT `tests/dynamic-qr-security-remediation.test.ts`: the two
  `generateQrBatchCore` tests now expect upload/remove order `[xlsx, docx]`
  (rename "CSV upload fails" -> "DOCX upload fails", mock throws on `.docx`).
- NEW `tests/qr-docx-export-migration.test.ts`: reads the new migration; asserts
  `add column ... r2_key_docx`, `commit_qr_export_batch` stores `r2_key_docx` and
  keeps the null-token check, `get_qr_export_key` has a `docx` branch, and
  service_role-only grants.
- EDIT `tests/qr-export-server.test.ts` only if `serveQrBatchDownload`/format
  typing is asserted there (legacy `serveQrExport` csv tests stay).
- Full `npm run verify` must be exit 0 before commit+push (repo AGENTS.md gate).

## Out of scope
- Changing the QR URL scheme, token format, debounce, or the confirmation
  interstitial.
- Dropping the `r2_key_csv` column or deleting old CSV artifacts.
- Touching legacy `/r/{id}/t/{n}` compatibility builders.
- Editing any previously-applied migration.

## Risks / notes
- Rendering up to 100 QR PNGs + assembling a DOCX runs inside the generate
  request (~1-2s, low memory). Acceptable for the Vercel Node runtime; if a
  future batch size grows well past 100, revisit (move to a queue or raise
  maxDuration).
- `docx` + `qrcode` are pure-JS and serverless-safe; verify they bundle in the
  Vercel build during the plan's build step.
- Supabase assigns its own ledger timestamp on apply; the repo filename
  `20260903100000_add_qr_docx_export.sql` is the source of truth for CI replay.
