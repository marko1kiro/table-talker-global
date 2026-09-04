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
