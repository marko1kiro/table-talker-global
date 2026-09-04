import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../src/routes/api/super-admin/qr-export/$batchId/$format.ts", import.meta.url),
    "utf8",
  );

it("routes permanent batch downloads to serveQrBatchDownload", () => {
  const file = source();
  expect(file).toContain('createFileRoute("/api/super-admin/qr-export/$batchId/$format")');
  expect(file).toContain('import("@/lib/qr-export.server")');
  expect(file).toContain("serveQrBatchDownload(");
  expect(file).toContain("params.batchId");
  expect(file).toContain("params.format");
});

it("does not accept a mutable domain query when serving archived files", () => {
  const file = source();
  expect(file).not.toContain("searchParams");
  expect(file).not.toContain('searchParams.get("domain")');
});

it("forwards the docx format to the batch downloader", () => {
  const file = source();
  expect(file).toContain('"xlsx" | "docx" | "csv"');
});
