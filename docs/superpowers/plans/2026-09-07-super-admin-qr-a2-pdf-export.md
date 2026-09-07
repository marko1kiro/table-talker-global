# Super Admin: A2 PDF Dynamic QR Export — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide print-ready A2 PDF (150 slots, 35x35mm per QR, center number badge, looping tables 1..N) for Super Admin QR generator and eliminate obsolete `docx`/`write-excel-file` dependencies.

**Architecture:**
- DB Migration: Add `r2_key_pdf` column to `public.qr_export_batches` and update `commit_qr_export_batch` / `get_qr_export_key` RPCs.
- Domain Logic: Round-robin 150 slot builder `buildA2QrSlots(rows: DynamicQrRow[]): Array<{ tableNumber: number; token: string }>`.
- PDF Generator: Pure streaming A2 PDF generator (`src/lib/qr-pdf.server.ts`) with vector hairline cutting boxes and high-contrast center number badge.
- Package Cleanup: Uninstall `docx` and `write-excel-file`, install `pdfkit` & `@types/pdfkit`.
- UI: Streamline `/super-admin/esb-export` to take `realTableCount` input and trigger A2 PDF generation & download.

**Tech Stack:** Node.js, `pdfkit`, `qrcode`, PostgreSQL RPC, TanStack Start, React.

**Spec:** `docs/superpowers/specs/2026-09-07-super-admin-qr-a2-pdf-export-design.md`

---

### Task 1: Migration — Add `r2_key_pdf` and update RPCs

**Files:**
- Create: `supabase/migrations/20260907140000_add_qr_pdf_export.sql`
- Create: `tests/add-qr-pdf-export-migration.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260907140000_add_qr_pdf_export.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("add qr pdf export migration", () => {
  it("adds r2_key_pdf column to qr_export_batches", () => {
    expect(sql).toContain("alter table public.qr_export_batches add column if not exists r2_key_pdf text");
  });
  it("updates commit_qr_export_batch signature to accept p_r2_key_pdf", () => {
    expect(sql).toContain("create or replace function public.commit_qr_export_batch");
    expect(sql).toContain("p_r2_key_pdf text");
  });
  it("updates get_qr_export_key to support pdf format", () => {
    expect(sql).toContain("when 'pdf' then b.r2_key_pdf");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/add-qr-pdf-export-migration.test.ts`
Expected: FAIL

- [ ] **Step 3: Write SQL migration file**

Create `supabase/migrations/20260907140000_add_qr_pdf_export.sql`:
```sql
-- Super Admin: A2 PDF format artifact for QR export batches.

alter table public.qr_export_batches add column if not exists r2_key_pdf text;

drop function if exists public.commit_qr_export_batch(
  uuid, uuid, text, text, text, integer[], text[], text, text
);

create or replace function public.commit_qr_export_batch(
  p_batch_id uuid,
  p_restaurant_id uuid,
  p_created_by text,
  p_domain_used text,
  p_scope text,
  p_table_numbers integer[],
  p_tokens text[],
  p_r2_key_pdf text,
  p_r2_key_docx text default null,
  p_r2_key_xlsx text default null
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
     or p_r2_key_pdf is null then
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
    r2_key_pdf, r2_key_docx, r2_key_xlsx
  ) values (
    p_batch_id, p_restaurant_id, p_created_by, p_domain_used, p_scope,
    p_table_numbers, p_r2_key_pdf, p_r2_key_docx, p_r2_key_xlsx
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
    when 'pdf' then b.r2_key_pdf
    when 'xlsx' then b.r2_key_xlsx
    when 'csv' then b.r2_key_csv
    when 'docx' then b.r2_key_docx
  end
  from public.qr_export_batches b
  where b.id = p_batch_id and p_format in ('pdf', 'xlsx', 'csv', 'docx');
$$;

revoke all on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text, text) from public, anon, authenticated;
revoke all on function public.get_qr_export_key(uuid, text) from public, anon, authenticated;
grant execute on function public.commit_qr_export_batch(uuid, uuid, text, text, text, integer[], text[], text, text, text) to service_role;
grant execute on function public.get_qr_export_key(uuid, text) to service_role;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/add-qr-pdf-export-migration.test.ts`
Expected: PASS

- [ ] **Step 5: Apply migration to Supabase prod**

Apply via `supabase_apply_migration`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260907140000_add_qr_pdf_export.sql tests/add-qr-pdf-export-migration.test.ts
git commit -m "feat(db): add r2_key_pdf and update QR export RPCs"
```

---

### Task 2: Dependency swap (`docx`/`write-excel-file` -> `pdfkit`) & Slot Looping Domain Logic

**Files:**
- Modify: `package.json`
- Create: `src/lib/qr-pdf-domain.ts`
- Create: `tests/qr-pdf-domain.test.ts`

- [ ] **Step 1: Install pdfkit and remove docx/write-excel-file**

Run: `npm install pdfkit @types/pdfkit && npm uninstall docx write-excel-file`

- [ ] **Step 2: Write failing test for slot builder**

```ts
import { describe, expect, it } from "vitest";
import { buildA2QrSlots, TOTAL_A2_SLOTS } from "../src/lib/qr-pdf-domain";

describe("buildA2QrSlots", () => {
  it("creates exactly 150 slots", () => {
    const rows = [
      { tableNumber: 1, token: "t1" },
      { tableNumber: 2, token: "t2" },
    ];
    const slots = buildA2QrSlots(rows);
    expect(slots.length).toBe(TOTAL_A2_SLOTS);
    expect(slots.length).toBe(150);
  });

  it("loops round-robin across table count", () => {
    const rows = Array.from({ length: 68 }, (_, i) => ({
      tableNumber: i + 1,
      token: `token_${i + 1}`,
    }));
    const slots = buildA2QrSlots(rows);
    // slot 0 is table 1, slot 67 is table 68
    expect(slots[0].tableNumber).toBe(1);
    expect(slots[67].tableNumber).toBe(68);
    // slot 68 loops to table 1
    expect(slots[68].tableNumber).toBe(1);
    // slot 135 is table 68
    expect(slots[135].tableNumber).toBe(68);
    // slot 136 loops to table 1
    expect(slots[136].tableNumber).toBe(1);
    // slot 149 is table 14
    expect(slots[149].tableNumber).toBe(14);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/qr-pdf-domain.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement `src/lib/qr-pdf-domain.ts`**

```ts
import type { DynamicQrRow } from "./qr-export.server";

export const TOTAL_A2_SLOTS = 150;
export const A2_COLUMNS = 10;
export const A2_ROWS = 15;

export function buildA2QrSlots(rows: DynamicQrRow[]): DynamicQrRow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.tableNumber - b.tableNumber);
  const slots: DynamicQrRow[] = [];
  for (let i = 0; i < TOTAL_A2_SLOTS; i++) {
    slots.push(sorted[i % sorted.length]);
  }
  return slots;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/qr-pdf-domain.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/qr-pdf-domain.ts tests/qr-pdf-domain.test.ts
git commit -m "feat: add A2 QR slot domain logic and swap dependencies to pdfkit"
```

---

### Task 3: PDF Generator (`src/lib/qr-pdf.server.ts`)

**Files:**
- Create: `src/lib/qr-pdf.server.ts`
- Delete: `src/lib/qr-docx.server.ts`
- Create: `tests/qr-pdf-generator.test.ts`

- [ ] **Step 1: Write failing test for PDF generator**

```ts
import { describe, expect, it } from "vitest";
import { generateA2QrPdfBuffer } from "../src/lib/qr-pdf.server";

describe("generateA2QrPdfBuffer", () => {
  it("generates a non-empty PDF buffer with PDF magic bytes", async () => {
    const rows = Array.from({ length: 68 }, (_, i) => ({
      tableNumber: i + 1,
      token: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde",
    }));
    const buf = await generateA2QrPdfBuffer(rows, "https://qris-order.lihatmeja.com");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(5000);
    // PDF Magic Header %PDF-
    expect(buf.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/qr-pdf-generator.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `src/lib/qr-pdf.server.ts`**

Generate QR codes with center number badge overlay (draw on QR PNG via canvas or embed QR vector/image with PDFKit box/text overlay) on A2 layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/qr-pdf-generator.test.ts`
Expected: PASS

- [ ] **Step 5: Prettier + delete obsolete docx + commit**

```bash
git rm src/lib/qr-docx.server.ts
git add src/lib/qr-pdf.server.ts tests/qr-pdf-generator.test.ts
git commit -m "feat: implement A2 PDF QR generator with center table badge"
```

---

### Task 4: Server Action & UI Updates

**Files:**
- Modify: `src/lib/qr-export.server.ts`
- Modify: `src/routes/super-admin/esb-export.tsx`
- Create: `tests/qr-export-pdf-server.test.ts`

- [ ] **Step 1: Write failing test**
- [ ] **Step 2: Update `src/lib/qr-export.server.ts` to output PDF artifact and store `r2_key_pdf`**
- [ ] **Step 3: Update `src/routes/super-admin/esb-export.tsx` UI for `realTableCount` input and PDF download button**
- [ ] **Step 4: Run all tests to verify they pass**
- [ ] **Step 5: Commit**

---

### Task 5: Full Verification (`npm run verify`)

- [ ] **Step 1: Run `npm run verify`**
- [ ] **Step 2: Report result and ask for push**
