import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/migrations/20260907140000_add_qr_pdf_export.sql", import.meta.url),
  "utf8",
);

describe("add qr pdf export migration", () => {
  it("adds r2_key_pdf column to qr_export_batches", () => {
    expect(sql).toContain(
      "alter table public.qr_export_batches add column if not exists r2_key_pdf text",
    );
  });
  it("updates commit_qr_export_batch signature to accept p_r2_key_pdf", () => {
    expect(sql).toContain("create or replace function public.commit_qr_export_batch");
    expect(sql).toContain("p_r2_key_pdf text");
  });
  it("updates get_qr_export_key to support pdf format", () => {
    expect(sql).toContain("when 'pdf' then b.r2_key_pdf");
  });
});
