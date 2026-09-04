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
    expect(sql).toContain("coalesce(cardinality(p_tokens), 0) <> cardinality(p_table_numbers)");
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
