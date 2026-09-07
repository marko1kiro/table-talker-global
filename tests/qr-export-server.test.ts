import { describe, expect, it, vi } from "vitest";
import {
  buildQrExportCsv,
  DEFAULT_QR_EXPORT_DOMAIN,
  serveQrExport,
} from "../src/lib/qr-export.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const DOMAIN = "https://qris-order.lihatmeja.com";

describe("DEFAULT_QR_EXPORT_DOMAIN", () => {
  it("defaults to the current interceptor domain", () => {
    expect(DEFAULT_QR_EXPORT_DOMAIN).toBe("https://qris-order.lihatmeja.com");
  });
});

describe("buildQrExportCsv", () => {
  it("produces a header row plus 100 data rows, comma-separated", () => {
    const csv = buildQrExportCsv(RESTAURANT_ID, DOMAIN);
    const lines = csv.trim().split("\n");
    expect(lines).toHaveLength(101);
    expect(lines[0]).toBe("table_number,url");
    expect(lines[1]).toBe(`1,https://qris-order.lihatmeja.com/r/${RESTAURANT_ID}/t/1`);
    expect(lines[100]).toBe(`100,https://qris-order.lihatmeja.com/r/${RESTAURANT_ID}/t/100`);
  });
});

describe("serveQrExport", () => {
  const lookup = vi.fn(async () => ({ displayName: "Mie Gacoan Kampung Bulu" }));

  it("returns a 401 when the caller is not an authenticated super admin", async () => {
    const requireAuth = vi.fn(async () => {
      throw new Error("UNAUTHORIZED");
    });
    const response = await serveQrExport(
      { restaurantId: RESTAURANT_ID, format: "csv", domain: DOMAIN },
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
      { restaurantId: RESTAURANT_ID, format: "invalid" as never, domain: DOMAIN },
      { requireAuth, lookup },
    );
    expect(response.status).toBe(400);
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
    expect(response.headers.get("cache-control")).toBe("no-store");
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
