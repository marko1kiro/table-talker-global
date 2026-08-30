import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../src/routes/api/super-admin/qr-export/$restaurantId/$format.ts", import.meta.url),
    "utf8",
  );

it("routes /api/super-admin/qr-export/$restaurantId/$format to serveQrExport", () => {
  const file = source();
  expect(file).toContain('createFileRoute("/api/super-admin/qr-export/$restaurantId/$format")');
  expect(file).toContain('import("@/lib/qr-export.server")');
  expect(file).toContain("serveQrExport(");
  expect(file).toContain("params.restaurantId");
  expect(file).toContain("params.format");
});

it("forwards the optional ?domain= query param without persisting it anywhere", () => {
  const file = source();
  expect(file).toContain('searchParams.get("domain")');
});
