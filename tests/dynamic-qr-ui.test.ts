import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ui = () =>
  readFileSync(new URL("../src/routes/super-admin/esb-export.tsx", import.meta.url), "utf8");
const routeUrl = new URL("../src/routes/q/$token.ts", import.meta.url);

describe("M-01 UI and route contracts", () => {
  it("exposes the opaque public /q/$token route and retires the guessable physical route", () => {
    expect(existsSync(routeUrl)).toBe(true);
    const route = readFileSync(routeUrl, "utf8");
    expect(route).toContain('createFileRoute("/q/$token")');
    expect(route).toContain("handleOpaqueQrRequest");
    expect(
      existsSync(new URL("../src/routes/r/$restaurantId/t/$tableNumber.ts", import.meta.url)),
    ).toBe(false);
  });

  it("offers all-table and selected-table generation with recent-admin confirmation", () => {
    const source = ui();
    expect(source).toContain("Semua meja");
    expect(source).toContain("Meja tertentu");
    expect(source).toContain("superAdminPassword");
    expect(source).toContain("Generate QR");
    expect(source).toContain("COBA LAGI");
  });

  it("shows permanent batch history, computed statuses, and both downloads", () => {
    const source = ui();
    expect(source).toContain("Riwayat QR");
    expect(source).toContain("ACTIVE");
    expect(source).toContain("EXPIRED");
    expect(source).toContain("SEBAGIAN AKTIF");
    expect(source).toContain("XLSX");
    expect(source).toContain("DOCX");
  });
});
