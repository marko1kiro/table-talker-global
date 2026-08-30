import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  defaultRecordQrScan,
  defaultRestaurantEsbLookup,
  handleQrInterceptorRequest,
  resolveEsbRedirectUrl,
} from "../src/lib/qr-interceptor.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";

describe("resolveEsbRedirectUrl", () => {
  it("builds the ESB order URL from esb_app_id and table number", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: true }));
    const result = await resolveEsbRedirectUrl(RESTAURANT_ID, 7, lookup);
    expect(lookup).toHaveBeenCalledWith(RESTAURANT_ID);
    expect(result).toEqual({
      ok: true,
      url: "https://esborder.qs.esb.co.id/APP/1294/order?mode=dinein&tableNumber=7",
    });
  });

  it("returns RESTAURANT_NOT_FOUND when the lookup finds no restaurant", async () => {
    const lookup = vi.fn(async () => null);
    const result = await resolveEsbRedirectUrl(RESTAURANT_ID, 7, lookup);
    expect(result).toEqual({ ok: false, code: "RESTAURANT_NOT_FOUND" });
  });

  it("returns RESTAURANT_INACTIVE when the restaurant is deactivated", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: false }));
    const result = await resolveEsbRedirectUrl(RESTAURANT_ID, 7, lookup);
    expect(result).toEqual({ ok: false, code: "RESTAURANT_INACTIVE" });
  });

  it("returns MISSING_ESB_APP_ID when esb_app_id has not been provisioned yet", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: null, isActive: true }));
    const result = await resolveEsbRedirectUrl(RESTAURANT_ID, 7, lookup);
    expect(result).toEqual({ ok: false, code: "MISSING_ESB_APP_ID" });
  });

  it("returns RESTAURANT_NOT_FOUND (never a raw error) if the lookup throws", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("connection reset");
    });
    const result = await resolveEsbRedirectUrl(RESTAURANT_ID, 7, lookup);
    expect(result).toEqual({ ok: false, code: "RESTAURANT_NOT_FOUND" });
  });

  it("URL-encodes esb_app_id defensively", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "12 94/x", isActive: true }));
    const result = await resolveEsbRedirectUrl(RESTAURANT_ID, 3, lookup);
    expect(result).toEqual({
      ok: true,
      url: "https://esborder.qs.esb.co.id/APP/12%2094%2Fx/order?mode=dinein&tableNumber=3",
    });
  });
});

describe("handleQrInterceptorRequest", () => {
  it("issues a 302 to the correct ESB URL for a valid restaurant + table", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: true }));
    const recordScan = vi.fn(async () => ({ ok: true as const }));

    const response = await handleQrInterceptorRequest(RESTAURANT_ID, "7", { lookup, recordScan });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://esborder.qs.esb.co.id/APP/1294/order?mode=dinein&tableNumber=7",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(recordScan).toHaveBeenCalledWith(RESTAURANT_ID, 7);
  });

  it("falls back to a safe 404 for an unknown restaurant, never leaking error detail", async () => {
    const lookup = vi.fn(async () => null);
    const recordScan = vi.fn(async () => ({ ok: true as const }));

    const response = await handleQrInterceptorRequest(RESTAURANT_ID, "7", { lookup, recordScan });

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).not.toMatch(/error|exception|postgres|null/i);
    // No scan is logged for a restaurant that structurally cannot exist —
    // record_qr_scan would raise the identical RESTAURANT_NOT_FOUND anyway.
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("falls back to a safe 404 for a malformed restaurant id or table number, never calling the lookup", async () => {
    const lookup = vi.fn();
    const recordScan = vi.fn();

    const badId = await handleQrInterceptorRequest("not-a-uuid", "7", { lookup, recordScan });
    expect(badId.status).toBe(404);

    const badTable = await handleQrInterceptorRequest(RESTAURANT_ID, "0", { lookup, recordScan });
    expect(badTable.status).toBe(404);

    const badTable2 = await handleQrInterceptorRequest(RESTAURANT_ID, "101", {
      lookup,
      recordScan,
    });
    expect(badTable2.status).toBe(404);

    const nonNumeric = await handleQrInterceptorRequest(RESTAURANT_ID, "abc", {
      lookup,
      recordScan,
    });
    expect(nonNumeric.status).toBe(404);

    expect(lookup).not.toHaveBeenCalled();
    expect(recordScan).not.toHaveBeenCalled();
  });

  it("still logs a scan (restaurant exists) but 404s for an inactive restaurant", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: false }));
    const recordScan = vi.fn(async () => ({ ok: true as const }));

    const response = await handleQrInterceptorRequest(RESTAURANT_ID, "7", { lookup, recordScan });

    expect(response.status).toBe(404);
    expect(recordScan).toHaveBeenCalledWith(RESTAURANT_ID, 7);
  });

  it("still produces the 302 when the scan-logging call fails (fail-open contract)", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: true }));
    const recordScan = vi.fn(async () => {
      throw new Error("db unavailable");
    });

    const response = await handleQrInterceptorRequest(RESTAURANT_ID, "7", { lookup, recordScan });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://esborder.qs.esb.co.id/APP/1294/order?mode=dinein&tableNumber=7",
    );
  });

  it("still produces the 302 when the scan-logging call hangs past its bounded timeout", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: true }));
    const recordScan = vi.fn(() => new Promise<{ ok: true }>(() => {})); // never resolves

    const response = await handleQrInterceptorRequest(RESTAURANT_ID, "7", {
      lookup,
      recordScan,
      scanTimeoutMs: 20,
    });

    expect(response.status).toBe(302);
  });

  it("repeated calls for an already-terisi table still redirect correctly and do not throw", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: true }));
    // Idempotent re-scan: the RPC itself is a no-op on occupancy state, but
    // still reports ok — the interceptor must not special-case this.
    const recordScan = vi.fn(async () => ({ ok: true as const }));

    const first = await handleQrInterceptorRequest(RESTAURANT_ID, "7", { lookup, recordScan });
    const second = await handleQrInterceptorRequest(RESTAURANT_ID, "7", { lookup, recordScan });

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(recordScan).toHaveBeenCalledTimes(2);
  });
});

describe("defaultRestaurantEsbLookup", () => {
  it("returns null when no service client is configured (e.g. missing env vars)", async () => {
    const original = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const result = await defaultRestaurantEsbLookup(RESTAURANT_ID);
      expect(result).toBeNull();
    } finally {
      if (original.url) process.env.SUPABASE_URL = original.url;
      if (original.key) process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
    }
  });
});

describe("defaultRecordQrScan", () => {
  it("returns UNAVAILABLE when no service client is configured (e.g. missing env vars)", async () => {
    const original = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const result = await defaultRecordQrScan(RESTAURANT_ID, 7);
      expect(result.ok).toBe(false);
    } finally {
      if (original.url) process.env.SUPABASE_URL = original.url;
      if (original.key) process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
    }
  });
});

describe("qr-interceptor.server.ts source contract", () => {
  const source = () =>
    readFileSync(new URL("../src/lib/qr-interceptor.server.ts", import.meta.url), "utf8");

  it("reuses recordQrScanCore from table-occupancy.server.ts rather than re-implementing the RPC call", () => {
    expect(source()).toMatch(
      /import\s*{[^}]*recordQrScanCore[^}]*}\s*from\s*"\.\/table-occupancy\.server"/,
    );
  });

  it("never imports the createServerFn-wrapped recordQrScan (server-internal callers use the Core fn directly)", () => {
    expect(source()).not.toMatch(/import\s*{[^}]*[^Q]recordQrScan\s*,/);
    expect(source()).not.toMatch(/,\s*recordQrScan\s*}\s*from/);
    expect(source()).not.toMatch(/{\s*recordQrScan\s*}/);
  });

  it("uses the service-role client, never a per-request anon+Bearer client", () => {
    expect(source()).toMatch(/getServiceClient/);
    expect(source()).not.toMatch(/getAnonAuthedSupabaseClient/);
  });
});
