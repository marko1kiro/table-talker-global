# Super Admin: A2 PDF Dynamic QR Export (150 Slots / Sheet) — Design Spec

**Date:** 2026-09-07  
**Status:** Approved

## Summary
Upgrade the Super Admin QR generation flow (`/super-admin/esb-export`) from DOCX/XLSX to a print-ready **A2 PDF** (420 mm × 594 mm). The sheet contains 150 sticker slots (10 columns × 15 rows) designed for 35 mm × 35 mm stickers with a 3 mm kiss-cut/die-cut gap. Super Admin enters the restaurant's actual table count (e.g., 68), and the generator fills all 150 slots in a continuous round-robin loop. Each QR code embeds a clear center number badge using Error Correction Level H. Obsolete `docx` and `write-excel-file` dependencies are removed.

## 1. Sheet Geometry & Printing Specifications

- **Page Size**: A2 Portrait (420 mm × 594 mm = 1190.55 pt × 1683.78 pt).
- **Sticker Size**: 35 mm × 35 mm (99.21 pt × 99.21 pt).
- **Cutting Gap (Pitch)**: 3 mm gap (38 mm pitch = 107.72 pt).
- **Grid Layout**: 10 columns × 15 rows = **150 stickers per A2 sheet**.
- **Margins**:
  - Horizontal margin: (420 - (10 × 38 - 3)) / 2 = 21.5 mm (left/right).
  - Vertical margin: (594 - (15 × 38 - 3)) / 2 = 13.5 mm (top/bottom).
  - Both comfortably exceed the 10 mm print gripping margin.
- **Cutting Guides**: Light neutral hairline border around each 35×35 mm slot for precision cutting.

## 2. QR Code Design & Center Badge

- **QR Error Correction**: Level `H` (30% recovery capacity).
- **URL Format**: `{domain}/q/{token}` (e.g. `https://qris-order.lihatmeja.com/q/{token}`).
- **Center Badge**:
  - Centered square cutout/badge (approx. 24% of QR dimension) with white background and subtle rounded border.
  - High-contrast black bold font displaying the table number (e.g., `1`, `12`, `68`).
  - Allows instant visual human verification while maintaining 100% fast camera scanability.

## 3. Allocation & Round-Robin Loop

- Super Admin inputs `realTableCount` (integer 1..100, default 100).
- Generates `realTableCount` unique dynamic tokens (stored in `qr_table_tokens` table for the restaurant).
- Populates the 150 slots on the A2 sheet sequentially:
  - Slot 1 → Table 1 (Token 1)
  - ...
  - Slot `realTableCount` → Table `realTableCount`
  - Slot `realTableCount + 1` → Table 1 (Token 1)
  - Continues looping until slot 150 is filled.

## 4. Database & Storage

### 4.1 Schema Migration (`public.qr_export_batches`)
- Add column `r2_key_pdf text`.
- Update RPC `public.commit_qr_export_batch(..., p_r2_key_pdf text)` to record the PDF artifact key in Cloudflare R2.
- Update RPC `public.get_qr_export_key(p_batch_id uuid, p_format text)` to support format `'pdf'`.

### 4.2 Storage Key Convention
- Key: `qr-exports/{restaurantId}/{batchId}/qr-codes-a2.pdf`.
- Content-Type: `application/pdf`.

## 5. Dependency & Code Cleanup

- **Remove Packages**: `docx` and `write-excel-file` from `package.json`.
- **Add Packages**: `pdfkit` and `@types/pdfkit` (lean, streaming vector PDF generation).
- **Clean Files**: Remove `src/lib/qr-docx.server.ts` and replace with `src/lib/qr-pdf.server.ts`.

## 6. UI Changes (`src/routes/super-admin/esb-export.tsx`)

- Replace table selector multi-checkbox with a streamlined **Jumlah Meja Real (1-100)** input field.
- Info box explaining the 150-slot A2 layout with looping calculation (e.g., "150 slot A2: Meja 1-68 dicetak 2x penuh + 14 sisa").
- Generate action produces A2 PDF.
- Batch history table provides immediate "Download PDF" action.

## 7. Verification & Testing

- Unit tests for round-robin 150-slot generator array.
- Unit tests for PDF buffer generation (A2 dimensions, 150 QR placements).
- Migration contract tests for `r2_key_pdf` and updated RPCs.
- UI source assertions for the updated input and PDF download triggers.
