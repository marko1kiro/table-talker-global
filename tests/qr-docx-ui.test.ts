import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/routes/super-admin/esb-export.tsx", import.meta.url), "utf8");

describe("QR PDF history buttons", () => {
  it("offers PDF download and no CSV button", () => {
    const file = source();
    expect(file).toContain('downloadBatch(batch.id, "pdf")');
    expect(file).not.toContain('downloadBatch(batch.id, "csv")');
  });

  it("types downloadBatch for pdf", () => {
    const file = source();
    expect(file).toMatch(
      /function downloadBatch\(batchId: string, format: "pdf" \| "xlsx" \| "docx"/,
    );
  });
});
