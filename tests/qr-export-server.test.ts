import { describe, expect, it, vi } from "vitest";
import {
  buildQrExportCsv,
  buildQrExportXlsxBuffer,
  DEFAULT_QR_EXPORT_DOMAIN,
  serveQrExport,
} from "../src/lib/qr-export.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const DOMAIN = "https://qr.xdirga.xyz";

describe("DEFAULT_QR_EXPORT_DOMAIN", () => {
  it("defaults to the current interceptor domain", () => {
    expect(DEFAULT_QR_EXPORT_DOMAIN).toBe("https://qr.xdirga.xyz");
  });
});

describe("buildQrExportCsv", () => {
  it("produces a header row plus 100 data rows, comma-separated", () => {
    const csv = buildQrExportCsv(RESTAURANT_ID, DOMAIN);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe("table_number,url");
    expect(lines[1]).toBe(`1,https://qr.xdirga.xyz/r/${RESTAURANT_ID}/t/1`);
    expect(lines[100]).toBe(`100,https://qr.xdirga.xyz/r/${RESTAURANT_ID}/t/100`);
  });
});

describe("buildQrExportXlsxBuffer", () => {
  it("produces a non-empty Buffer (a real .xlsx file)", async () => {
    const buffer = await buildQrExportXlsxBuffer(RESTAURANT_ID, DOMAIN);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);
    // .xlsx files are zip archives -- PK\x03\x04 magic bytes.
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});

describe("serveQrExport", () => {
  const lookup = vi.fn(async () => ({ displayName: "Mie Gacoan Kampung Bulu" }));

  it("returns a 401 when the caller is not an authenticated super admin", async () => {
    const requireAuth = vi.fn(async () => {
      throw new Error("UNAUTHORIZED");
    });
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "xlsx", domain: DOMAIN },
      { requireAuth, lookup },
    );
    expect(response.status).toBe(401);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown restaurant, never leaking error detail", async () => {
    const requireAuth = vi.fn(async () => {});
    const notFoundLookup = vi.fn(async () => null);
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "csv", domain: DOMAIN },
      { requireAuth, lookup: notFoundLookup },
    );
    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/error|exception|postgres/i);
  });

  it("returns 400 for an invalid format", async () => {
    const requireAuth = vi.fn(async () => {});
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "pdf" as never, domain: DOMAIN },
      { requireAuth, lookup },
    );
    expect(response.status).toBe(400);
  });

  it("serves .xlsx with the correct Content-Type, Content-Disposition and no-store cache header", async () => {
    const requireAuth = vi.fn(async () => {});
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "xlsx", domain: DOMAIN },
      { requireAuth, lookup },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain(".xlsx");
    expect(response.headers.get("cache-control")).toBe("no-store");
    const buffer = Buffer.from(await response.arrayBuffer());
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("serves .csv with the correct Content-Type and Content-Disposition", async () => {
    const requireAuth = vi.fn(async () => {});
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "csv", domain: DOMAIN },
      { requireAuth, lookup },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toContain("attachment");
    expect(response.headers.get("content-disposition")).toContain(".csv");
    const text = await response.text();
    expect(text.split("\n")[0]).toBe("table_number,url");
  });

  it("falls back to the default domain when none is provided", async () => {
    const requireAuth = vi.fn(async () => {});
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "csv" },
      { requireAuth, lookup },
    );
    const text = await response.text();
    expect(text).toContain(DEFAULT_QR_EXPORT_DOMAIN);
  });
});
