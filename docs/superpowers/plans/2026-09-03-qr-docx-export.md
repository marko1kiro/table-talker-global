# QR DOCX Server-Side Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the super-admin "Generate QR" flow build a printable DOCX of QR images on the server (alongside the XLSX link list), store it encrypted in R2, and expose XLSX + DOCX download buttons (replacing CSV).

**Architecture:** Reuse the existing opaque-token batch pipeline in `qr-export.server.ts`. Add a pure DOCX builder (`qr-docx.server.ts`) ported from the local `qr-meja-generator` tool, swap the dynamic CSV artifact for DOCX inside `generateQrBatchCore`, persist an `r2_key_docx` column via one additive migration, and re-point the download route + UI buttons.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`, `esModuleInterop: false` -> named imports only), TanStack Start server routes, Vitest, Cloudflare R2 (AES-GCM encrypted artifacts), Supabase Postgres (security-definer RPCs), `docx` + `qrcode` libs.

**Binding rules (repo AGENTS.md):** strict TDD (MERAH -> HIJAU), run `npm run verify` (test+typecheck+lint+build) to exit 0 before every commit+push, never edit an already-applied migration, distinguish repo migration filename from Supabase ledger version.

Spec: `docs/superpowers/specs/2026-09-03-qr-docx-export-design.md`

---

## File Structure

- Create `src/lib/qr-docx.server.ts` — pure DOCX renderer: `sortQrRowsAscending`, `buildDynamicQrExportDocxBuffer`.
- Modify `src/lib/qr-export.server.ts` — swap CSV for DOCX in the batch flow; `CommitQrBatchInput.r2KeyDocx`; `QrExportFormat = "xlsx" | "docx"`; `serveQrBatchDownload` accepts `xlsx | docx | csv`.
- Modify `src/lib/r2.server.ts` — allow `.docx` in `QR_EXPORT_KEY_PATTERN`.
- Modify `src/routes/api/super-admin/qr-export/$batchId/$format.ts` — cast format to include `docx`.
- Modify `src/routes/super-admin/esb-export.tsx` — DOCX button replaces CSV; `downloadBatch` type; copy.
- Create `supabase/migrations/20260903100000_add_qr_docx_export.sql` — add `r2_key_docx`, redefine `commit_qr_export_batch` + `get_qr_export_key`.
- Create `tests/qr-docx-domain.test.ts`, `tests/qr-docx-export-migration.test.ts`, `tests/qr-docx-ui.test.ts`.
- Modify `tests/dynamic-qr-export.test.ts`, `tests/dynamic-qr-security-remediation.test.ts`.
- Modify `package.json` (+ lockfile) — deps `docx`, `qrcode`; devDep `@types/qrcode`.

---

## Task 1: Add `docx` + `qrcode` dependencies

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install runtime deps**

Run:
```bash
npm install docx qrcode
```
Expected: `package.json` `dependencies` gains `"docx"` and `"qrcode"`; exit 0.

- [ ] **Step 2: Install qrcode types (qrcode ships no types)**

Run:
```bash
npm install -D @types/qrcode
```
Expected: `package.json` `devDependencies` gains `"@types/qrcode"`; exit 0.

- [ ] **Step 3: Sanity typecheck resolves the new modules**

Run:
```bash
npx tsc --noEmit
```
Expected: exit 0 (no new errors; nothing imports them yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add docx and qrcode deps for server-side QR export"
```

---

## Task 2: Pure DOCX builder `src/lib/qr-docx.server.ts`

**Files:**
- Create: `src/lib/qr-docx.server.ts`
- Test: `tests/qr-docx-domain.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/qr-docx-domain.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  buildDynamicQrExportDocxBuffer,
  sortQrRowsAscending,
} from "../src/lib/qr-docx.server";

const DOMAIN = "https://qris-order.lihatmeja.com";
const TOKEN = "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ";

describe("QR DOCX builder", () => {
  it("sorts rows ascending by table number without mutating the input", () => {
    const input = [
      { tableNumber: 30, token: TOKEN },
      { tableNumber: 1, token: TOKEN },
      { tableNumber: 6, token: TOKEN },
    ];
    expect(sortQrRowsAscending(input).map((r) => r.tableNumber)).toEqual([1, 6, 30]);
    expect(input.map((r) => r.tableNumber)).toEqual([30, 1, 6]);
  });

  it("renders a non-contiguous subset as a valid docx (zip) buffer", async () => {
    const buffer = await buildDynamicQrExportDocxBuffer(
      [
        { tableNumber: 30, token: TOKEN },
        { tableNumber: 1, token: TOKEN },
        { tableNumber: 6, token: TOKEN },
      ],
      DOMAIN,
    );
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("renders a single-table batch without error", async () => {
    const buffer = await buildDynamicQrExportDocxBuffer(
      [{ tableNumber: 1, token: TOKEN }],
      DOMAIN,
    );
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/qr-docx-domain.test.ts`
Expected: FAIL — cannot resolve `../src/lib/qr-docx.server`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/qr-docx.server.ts`:
```ts
import { toBuffer } from "qrcode";
import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";
import type { DynamicQrRow } from "./qr-export.server";

const QR_RENDER_PX = 520;
const QR_DISPLAY_PX = 128;
const PER_ROW = 4;

export function sortQrRowsAscending(rows: DynamicQrRow[]): DynamicQrRow[] {
  return [...rows].sort((a, b) => a.tableNumber - b.tableNumber);
}

function noBorders() {
  const nil = { style: BorderStyle.NIL, size: 0, color: "FFFFFF" };
  return {
    top: nil,
    bottom: nil,
    left: nil,
    right: nil,
    insideHorizontal: nil,
    insideVertical: nil,
  };
}

export async function buildDynamicQrExportDocxBuffer(
  rows: DynamicQrRow[],
  domain: string,
): Promise<Buffer> {
  const base = domain.trim().replace(/\/+$/, "");
  const sorted = sortQrRowsAscending(rows);
  const tableRows: TableRow[] = [];

  for (let i = 0; i < sorted.length; i += PER_ROW) {
    const cells: TableCell[] = [];
    for (let j = 0; j < PER_ROW; j++) {
      const item = sorted[i + j];
      if (!item) {
        cells.push(
          new TableCell({
            width: { size: 25, type: WidthType.PERCENTAGE },
            borders: noBorders(),
            children: [new Paragraph("")],
          }),
        );
        continue;
      }
      const png = await toBuffer(`${base}/q/${item.token}`, {
        type: "png",
        width: QR_RENDER_PX,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      cells.push(
        new TableCell({
          width: { size: 25, type: WidthType.PERCENTAGE },
          borders: noBorders(),
          margins: { top: 80, bottom: 150, left: 50, right: 50 },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 40 },
              children: [
                new ImageRun({
                  data: png,
                  transformation: { width: QR_DISPLAY_PX, height: QR_DISPLAY_PX },
                  type: "png",
                }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: `Meja ${item.tableNumber}`,
                  bold: true,
                  size: 22,
                  font: "Arial",
                }),
              ],
            }),
          ],
        }),
      );
    }
    tableRows.push(new TableRow({ children: cells, cantSplit: true }));
  }

  const doc = new Document({
    creator: "LIME",
    title: "QR Nomor Meja",
    description: "QR nomor meja, empat kolom per baris",
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 500, right: 450, bottom: 500, left: 450 },
          },
        },
        children: [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: [2750, 2750, 2750, 2750],
            borders: noBorders(),
            rows: tableRows,
          }),
        ],
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/qr-docx-domain.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/qr-docx.server.ts tests/qr-docx-domain.test.ts
git commit -m "feat: add server-side QR DOCX builder (4-per-row A4 sheet)"
```

---

## Task 3: Wire DOCX into the batch flow (replace dynamic CSV)

**Files:**
- Modify: `src/lib/qr-export.server.ts`
- Modify: `src/lib/r2.server.ts:26`
- Test: `tests/dynamic-qr-export.test.ts`, `tests/dynamic-qr-security-remediation.test.ts`

- [ ] **Step 1: Update the failing tests (MERAH)**

In `tests/dynamic-qr-export.test.ts`:

Replace the `qrExportKey` csv assertion (lines 43-45):
```ts
    expect(qrExportKey(RESTAURANT_ID, BATCH_ID, "docx")).toBe(
      `qr-exports/${RESTAURANT_ID}/${BATCH_ID}/qr-codes.docx`,
    );
```

In the "uploads both files before atomically committing" test, change the upload-label mock (line 51) and the order assertion (line 71):
```ts
    const upload = vi.fn(async (key: string) => {
      order.push(`upload:${key.endsWith(".xlsx") ? "xlsx" : "docx"}`);
    });
```
```ts
    expect(order).toEqual(["upload:xlsx", "upload:docx", "commit"]);
```

In the "leaves active database tokens untouched when either R2 upload fails" test, change the throw trigger (line 98):
```ts
          upload: vi.fn(async (key: string) => {
            if (key.endsWith(".docx")) throw new Error("R2 unavailable");
          }),
```

In `tests/dynamic-qr-security-remediation.test.ts`:

"removes both uploaded artifacts before retrying a token collision" — change the expected remove list (lines 102-105):
```ts
    expect(order.slice(firstCommitIndex + 1, secondUploadIndex)).toEqual([
      `remove:qr-exports/${RESTAURANT_ID}/${firstBatch}/qr-codes.xlsx`,
      `remove:qr-exports/${RESTAURANT_ID}/${firstBatch}/qr-codes.docx`,
    ]);
```

Rename and update the last test (lines 108-135):
```ts
  it("removes a completed XLSX upload when the DOCX upload fails", async () => {
    const remove = vi.fn(async (_key: string): Promise<void> => {});
    await expect(
      generateQrBatchCore(
        {
          restaurantId: RESTAURANT_ID,
          domain: "https://qr.xdirga.xyz",
          scope: "selected",
          tableNumbers: [1],
          createdBy: "super-admin",
        },
        {
          generateBatchId: () => "7359da62-dc98-4a81-9a0f-56da46f32f70",
          generateToken: () => "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ",
          upload: vi.fn(async (key) => {
            if (key.endsWith(".docx")) throw new Error("DOCX upload failed");
          }),
          remove,
          commit: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("DOCX upload failed");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls.map(([key]) => key)).toEqual([
      expect.stringMatching(/\.xlsx$/),
      expect.stringMatching(/\.docx$/),
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/dynamic-qr-export.test.ts tests/dynamic-qr-security-remediation.test.ts`
Expected: FAIL — `qrExportKey(..., "docx")` type error / upload order still `csv`.

- [ ] **Step 3: Implement the source changes**

In `src/lib/qr-export.server.ts`:

Add the import near the top (after the `buildQrExportRows` import):
```ts
import { buildDynamicQrExportDocxBuffer } from "./qr-docx.server";
```

Change the format type (line 14). Keep `csv` in the union because the legacy
`serveQrExport` compatibility path (and its tests) still emit CSV; only the
generate flow stops using it:
```ts
export type QrExportFormat = "xlsx" | "csv" | "docx";
```

Change `CommitQrBatchInput` (lines 106-107):
```ts
  r2KeyXlsx: string;
  r2KeyDocx: string;
```

Change `defaultCommitQrBatch` RPC args (line 138):
```ts
    p_r2_key_docx: input.r2KeyDocx,
```

Change the artifact build block in `generateQrBatchCore` (lines 167-172):
```ts
    const r2KeyXlsx = qrExportKey(input.restaurantId, batchId, "xlsx");
    const r2KeyDocx = qrExportKey(input.restaurantId, batchId, "docx");
    const [xlsx, docx] = await Promise.all([
      buildDynamicQrExportXlsxBuffer(rows, domain),
      buildDynamicQrExportDocxBuffer(rows, domain),
    ]);
```

Change `commitInput` (line 184):
```ts
      r2KeyXlsx,
      r2KeyDocx,
```

Change the upload sequence (lines 195-196):
```ts
      attemptedKeys.push(r2KeyDocx);
      await upload(
        r2KeyDocx,
        new Uint8Array(docx),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
```

Change `serveQrBatchDownload` signature + validation + content-type (lines 340-363):
```ts
export async function serveQrBatchDownload(
  batchId: string,
  format: "xlsx" | "docx" | "csv",
): Promise<Response> {
  try {
    await requireSuperAdmin();
  } catch {
    return response("Tidak diizinkan.", 401);
  }
  if (format !== "xlsx" && format !== "docx" && format !== "csv")
    return response("Format export tidak dikenal.", 400);
```
```ts
    const contentType =
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : format === "docx"
          ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          : "text/csv; charset=utf-8";
```

Leave `buildDynamicQrExportCsv` defined (still exported + tested); it is simply no longer called by the flow.

In `src/lib/r2.server.ts` (line 26):
```ts
const QR_EXPORT_KEY_PATTERN =
  /^qr-exports\/[0-9a-f-]+\/[0-9a-f-]+\/qr-codes\.(xlsx|csv|docx)$/i;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/dynamic-qr-export.test.ts tests/dynamic-qr-security-remediation.test.ts tests/qr-docx-domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/qr-export.server.ts src/lib/r2.server.ts tests/dynamic-qr-export.test.ts tests/dynamic-qr-security-remediation.test.ts
git commit -m "feat: build DOCX QR sheet in generateQrBatchCore, retire dynamic CSV"
```

---

## Task 4: Download route accepts `docx`

**Files:**
- Modify: `src/routes/api/super-admin/qr-export/$batchId/$format.ts:9`
- Test: `tests/qr-export-route.test.ts`

- [ ] **Step 1: Add the failing route assertion (MERAH)**

Append to `tests/qr-export-route.test.ts`:
```ts
it("forwards the docx format to the batch downloader", () => {
  const file = source();
  expect(file).toContain('"xlsx" | "docx" | "csv"');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/qr-export-route.test.ts`
Expected: FAIL — route still casts `"xlsx" | "csv"`.

- [ ] **Step 3: Implement**

In `src/routes/api/super-admin/qr-export/$batchId/$format.ts` (line 9):
```ts
        return serveQrBatchDownload(params.batchId, params.format as "xlsx" | "docx" | "csv");
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/qr-export-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/super-admin/qr-export/$batchId/$format.ts tests/qr-export-route.test.ts
git commit -m "feat: allow docx format on the QR batch download route"
```

---

## Task 5: Migration — `r2_key_docx` column + RPC updates

**Files:**
- Create: `supabase/migrations/20260903100000_add_qr_docx_export.sql`
- Test: `tests/qr-docx-export-migration.test.ts`

- [ ] **Step 1: Write the failing contract test (MERAH)**

Create `tests/qr-docx-export-migration.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const url = new URL(
  "../supabase/migrations/20260903100000_add_qr_docx_export.sql",
  import.meta.url,
);
const source = () => readFileSync(url, "utf8").toLowerCase();

describe("QR DOCX export migration", () => {
  it("adds r2_key_docx without dropping csv history", () => {
    const sql = source();
    expect(sql).toContain("add column if not exists r2_key_docx");
    expect(sql).not.toContain("drop column");
  });

  it("stores the docx key and keeps the null-token guard", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.commit_qr_export_batch");
    expect(sql).toContain("p_r2_key_docx");
    expect(sql).toContain("r2_key_xlsx, r2_key_docx");
    expect(sql).toContain(
      "coalesce(cardinality(p_tokens), 0) <> cardinality(p_table_numbers)",
    );
  });

  it("teaches get_qr_export_key about docx", () => {
    const sql = source();
    expect(sql).toContain("when 'docx' then b.r2_key_docx");
    expect(sql).toMatch(/p_format in \('xlsx', 'csv', 'docx'\)/);
  });

  it("keeps service_role as the only executor", () => {
    const sql = source();
    expect(sql).toMatch(
      /grant execute on function public\.commit_qr_export_batch[\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_qr_export_key[\s\S]*to service_role/,
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/qr-docx-export-migration.test.ts`
Expected: FAIL — ENOENT on the migration file.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260903100000_add_qr_docx_export.sql`:
```sql
-- Server-side DOCX QR artifact; replaces the dynamic CSV in the generate flow.
-- Additive: r2_key_csv is kept for pre-existing batches (never dropped).

alter table public.qr_export_batches add column if not exists r2_key_docx text;

create or replace function public.commit_qr_export_batch(
  p_batch_id uuid,
  p_restaurant_id uuid,
  p_created_by text,
  p_domain_used text,
  p_scope text,
  p_table_numbers integer[],
  p_tokens text[],
  p_r2_key_xlsx text,
  p_r2_key_docx text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_scope not in ('all', 'selected')
     or p_created_by is null or char_length(p_created_by) not between 1 and 120
     or p_domain_used !~ '^https?://'
     or coalesce(cardinality(p_table_numbers), 0) not between 1 and 100
     or coalesce(cardinality(p_tokens), 0) <> cardinality(p_table_numbers)
     or p_r2_key_xlsx is null or p_r2_key_docx is null then
    raise exception 'INVALID_QR_BATCH';
  end if;

  select count(*) into v_count
  from (select distinct n from unnest(p_table_numbers) n where n between 1 and 100) valid;
  if v_count <> cardinality(p_table_numbers)
     or exists (select 1 from unnest(p_tokens) t where t !~ '^[A-Za-z0-9_-]{43}$') then
    raise exception 'INVALID_QR_BATCH';
  end if;

  if not exists (
    select 1 from public.restaurants r
    where r.id = p_restaurant_id and r.is_active
  ) then
    raise exception 'RESTAURANT_NOT_ACTIVE';
  end if;

  insert into public.qr_export_batches (
    id, restaurant_id, created_by, domain_used, scope, table_numbers,
    r2_key_xlsx, r2_key_docx
  ) values (
    p_batch_id, p_restaurant_id, p_created_by, p_domain_used, p_scope,
    p_table_numbers, p_r2_key_xlsx, p_r2_key_docx
  );

  update public.qr_table_tokens
  set revoked_at = now()
  where restaurant_id = p_restaurant_id
    and table_number = any(p_table_numbers)
    and revoked_at is null;

  insert into public.qr_table_tokens (
    restaurant_id, table_number, token, batch_id
  )
  select p_restaurant_id, selected.table_number, selected.token, p_batch_id
  from unnest(p_table_numbers, p_tokens) as selected(table_number, token);
end;
$$;

create or replace function public.get_qr_export_key(
  p_batch_id uuid,
  p_format text
)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select case p_format
    when 'xlsx' then b.r2_key_xlsx
    when 'csv' then b.r2_key_csv
    when 'docx' then b.r2_key_docx
  end
  from public.qr_export_batches b
  where b.id = p_batch_id and p_format in ('xlsx', 'csv', 'docx');
$$;

revoke all on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text) from public, anon, authenticated;
revoke all on function public.get_qr_export_key(uuid, text) from public, anon, authenticated;
grant execute on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text) to service_role;
grant execute on function public.get_qr_export_key(uuid, text) to service_role;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/qr-docx-export-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260903100000_add_qr_docx_export.sql tests/qr-docx-export-migration.test.ts
git commit -m "feat(db): add r2_key_docx column and docx-aware QR RPCs"
```

---

## Task 6: Super-admin UI — DOCX button replaces CSV

**Files:**
- Modify: `src/routes/super-admin/esb-export.tsx:138,236,369-375`
- Test: `tests/qr-docx-ui.test.ts`

- [ ] **Step 1: Write the failing UI contract test (MERAH)**

Create `tests/qr-docx-ui.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/super-admin/esb-export.tsx", import.meta.url), "utf8");

describe("QR DOCX history buttons", () => {
  it("offers XLSX and DOCX downloads and no CSV button", () => {
    const file = source();
    expect(file).toContain('downloadBatch(batch.id, "xlsx")');
    expect(file).toContain('downloadBatch(batch.id, "docx")');
    expect(file).not.toContain('downloadBatch(batch.id, "csv")');
  });

  it("types downloadBatch for xlsx or docx", () => {
    const file = source();
    expect(file).toMatch(/function downloadBatch\(batchId: string, format: "xlsx" \| "docx"\)/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/qr-docx-ui.test.ts`
Expected: FAIL — still `csv` button + `"xlsx" | "csv"` type.

- [ ] **Step 3: Implement**

In `src/routes/super-admin/esb-export.tsx`:

`downloadBatch` signature (line 138):
```ts
  function downloadBatch(batchId: string, format: "xlsx" | "docx") {
```

Generate-panel copy (line 236):
```tsx
              QR lama baru dinonaktifkan setelah file XLSX dan DOCX baru berhasil
              disimpan.
```

Replace the CSV button block (lines 369-375):
```tsx
                        <button
                          type="button"
                          className={ownerSecondaryButtonClass}
                          onClick={() => downloadBatch(batch.id, "docx")}
                        >
                          <Download className="size-4" /> DOCX
                        </button>
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/qr-docx-ui.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/super-admin/esb-export.tsx tests/qr-docx-ui.test.ts
git commit -m "feat(ui): swap QR history CSV button for DOCX download"
```

---

## Task 7: Full gate, apply migration, smoke, push

**Files:** none new (verification + deploy).

- [ ] **Step 1: Full quality gate**

Run: `npm run verify`
Expected: exit 0 (test + typecheck + lint + build). If lint flags CRLF from PowerShell edits, run `npx prettier --write` on the touched `.ts`/`.tsx` files and re-run.

- [ ] **Step 2: Apply the migration to the Supabase target**

Use the Supabase MCP `apply_migration` tool with name `add_qr_docx_export` and the exact SQL body from Task 5 Step 3. Record the Supabase-assigned ledger version (differs from the repo filename `20260903100000_add_qr_docx_export.sql`). Do NOT re-run if already present.

- [ ] **Step 3: Read-back schema + grants**

Run via `supabase_execute_sql`:
```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema='public' AND table_name='qr_export_batches' AND column_name='r2_key_docx') AS has_docx_col,
  (SELECT position('p_r2_key_docx' in lower(pg_get_functiondef('public.commit_qr_export_batch(uuid,uuid,text,text,text,integer[],text[],text,text)'::regprocedure))) > 0) AS commit_has_docx,
  (SELECT position('when ''docx''' in lower(pg_get_functiondef('public.get_qr_export_key(uuid,text)'::regprocedure))) > 0) AS getkey_has_docx;
```
Expected: `has_docx_col=1`, `commit_has_docx=true`, `getkey_has_docx=true`.

- [ ] **Step 4: Transactional RPC smoke (no production side effects)**

Run via `supabase_execute_sql` (wrapped so nothing commits):
```sql
BEGIN;
SELECT public.commit_qr_export_batch(
  '00000000-0000-0000-0000-0000000000aa'::uuid,
  '33916a05-7e95-42fa-bc3c-050bed2402c5',
  'smoke', 'https://qris-order.lihatmeja.com', 'selected',
  array[1], array['bNhGgUksFav2F5WDqG3-M09fXd6wJOjC9ItFHvf08EI'],
  'qr-exports/33916a05-7e95-42fa-bc3c-050bed2402c5/00000000-0000-0000-0000-0000000000aa/qr-codes.xlsx',
  'qr-exports/33916a05-7e95-42fa-bc3c-050bed2402c5/00000000-0000-0000-0000-0000000000aa/qr-codes.docx'
);
SELECT public.get_qr_export_key('00000000-0000-0000-0000-0000000000aa'::uuid, 'docx');
ROLLBACK;
```
Expected: `get_qr_export_key` returns the `.../qr-codes.docx` key (proves commit stored it + get_key reads it). ROLLBACK leaves no batch/token rows.

- [ ] **Step 5: Push**

```bash
git push origin main
```
Expected: `main` advances.

- [ ] **Step 6: Verify CI + Vercel**

Run: `gh api repos/marko1kiro/table-talker-global/commits/$(git rev-parse HEAD)/check-runs --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'`
Expected: `db-reset: completed success` (migrations replay incl. the new file).

Run: `vercel ls lihat-meja --json` and confirm the deployment for the new SHA reaches `state: READY`, `target: production`.

- [ ] **Step 7: Report + hand physical test to user**

Tell the user to open the super-admin "ESB & Export QR" page, Generate QR for a subset (e.g. tables 1, 6, 30), then click the new **DOCX** button and confirm the sheet shows 1, 6, 30 in order with a QR + "Meja N" label each.
