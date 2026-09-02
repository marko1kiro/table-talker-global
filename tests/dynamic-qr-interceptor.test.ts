import { describe, expect, it, vi } from "vitest";
import {
  INVALID_QR_MESSAGE,
  handleOpaqueQrRequest,
  hashQrScannerIp,
} from "../src/lib/dynamic-qr.server";

const TOKEN = "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ";
const SCAN_ID = "7359da62-dc98-4a81-9a0f-56da46f32f70";
const TRUSTED_HEADERS = new Headers({ "x-vercel-forwarded-for": "198.51.100.9" });
const RESOLVED = {
  restaurantId: "33916a05-7e95-42fa-bc3c-050bed2402c5",
  tableNumber: 7,
  esbAppId: "1294",
  enqueued: true,
};

describe("M-01 opaque QR interceptor", () => {
  it("uses a stable SHA-256 hash rather than storing a raw scanner IP", () => {
    const hash = hashQrScannerIp("198.51.100.9");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashQrScannerIp("198.51.100.9"));
    expect(hash).not.toContain("198.51.100.9");
  });

  it("resolves a valid opaque token, processes its durable outbox row, and redirects to ESB", async () => {
    const resolveAndEnqueue = vi.fn(async () => RESOLVED);
    const processPendingScan = vi.fn(async () => {});
    const response = await handleOpaqueQrRequest(TOKEN, TRUSTED_HEADERS, {
      resolveAndEnqueue,
      processPendingScan,
      generateScanId: () => SCAN_ID,
      scanTimeoutMs: 100,
    });
    expect(resolveAndEnqueue).toHaveBeenCalledWith(SCAN_ID, TOKEN, hashQrScannerIp("198.51.100.9"));
    expect(processPendingScan).toHaveBeenCalledWith(SCAN_ID);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://esborder.qs.esb.co.id/APP/1294/order?mode=dinein&tableNumber=7",
    );
  });

  it("redirects but does not reprocess a scan suppressed by debounce or rate limit", async () => {
    const processPendingScan = vi.fn(async () => {});
    const response = await handleOpaqueQrRequest(TOKEN, TRUSTED_HEADERS, {
      resolveAndEnqueue: vi.fn(async () => ({ ...RESOLVED, enqueued: false })),
      processPendingScan,
      generateScanId: () => SCAN_ID,
    });
    expect(response.status).toBe(302);
    expect(processPendingScan).not.toHaveBeenCalled();
  });

  it.each(["unknown token", "revoked token", "inactive restaurant", "missing ESB config"])(
    "shows the approved popup and never records a scan for %s",
    async () => {
      const processPendingScan = vi.fn(async () => {});
      const response = await handleOpaqueQrRequest(TOKEN, TRUSTED_HEADERS, {
        resolveAndEnqueue: vi.fn(async () => null),
        processPendingScan,
        generateScanId: () => SCAN_ID,
      });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toContain("text/html");
      const html = await response.text();
      expect(html).toContain(`<dialog open`);
      expect(html).toContain(INVALID_QR_MESSAGE);
      expect(html).toContain(">TUTUP<");
      expect(processPendingScan).not.toHaveBeenCalled();
    },
  );

  it("uses the same safe popup when token syntax is invalid or lookup is unavailable", async () => {
    const lookup = vi.fn(async () => {
      throw new Error("secret database detail");
    });
    const malformed = await handleOpaqueQrRequest("guessable", TRUSTED_HEADERS, {
      resolveAndEnqueue: lookup,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(await malformed.text()).toContain(INVALID_QR_MESSAGE);

    const unavailable = await handleOpaqueQrRequest(TOKEN, TRUSTED_HEADERS, {
      resolveAndEnqueue: lookup,
      generateScanId: () => SCAN_ID,
    });
    const html = await unavailable.text();
    expect(html).toContain(INVALID_QR_MESSAGE);
    expect(html).not.toContain("secret database detail");
  });
});
