import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  handleQrInterceptorRequest,
  persistQrScanBestEffort,
} from "../src/lib/qr-interceptor.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const SCAN_ID = "7359da62-dc98-4a81-9a0f-56da46f32f70";

describe("M-03 durable QR scan flow", () => {
  it("durably enqueues a scan before attempting immediate processing", async () => {
    const order: string[] = [];
    let releaseEnqueue!: () => void;
    const enqueueScan = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseEnqueue = () => {
            order.push("enqueue");
            resolve();
          };
        }),
    );
    const processPendingScan = vi.fn(async () => {
      order.push("process");
    });

    const pending = persistQrScanBestEffort(
      SCAN_ID,
      RESTAURANT_ID,
      7,
      enqueueScan,
      processPendingScan,
      100,
    );

    expect(processPendingScan).not.toHaveBeenCalled();
    releaseEnqueue();
    await pending;

    expect(enqueueScan).toHaveBeenCalledWith(SCAN_ID, RESTAURANT_ID, 7);
    expect(processPendingScan).toHaveBeenCalledWith(SCAN_ID);
    expect(order).toEqual(["enqueue", "process"]);
  });

  it("does not process when the durable enqueue fails, while swallowing the failure", async () => {
    const enqueueScan = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    const processPendingScan = vi.fn(async () => {});

    await expect(
      persistQrScanBestEffort(SCAN_ID, RESTAURANT_ID, 7, enqueueScan, processPendingScan, 100),
    ).resolves.toBeUndefined();
    expect(processPendingScan).not.toHaveBeenCalled();
  });

  it("uses one bounded budget for enqueue plus immediate processing", async () => {
    const enqueueScan = vi.fn(() => new Promise<void>(() => {}));
    const processPendingScan = vi.fn(async () => {});

    await expect(
      persistQrScanBestEffort(SCAN_ID, RESTAURANT_ID, 7, enqueueScan, processPendingScan, 10),
    ).resolves.toBeUndefined();
    expect(processPendingScan).not.toHaveBeenCalled();
  });

  it("keeps the customer redirect fail-open when immediate processing times out", async () => {
    const lookup = vi.fn(async () => ({ esbAppId: "1294", isActive: true }));
    const enqueueScan = vi.fn(async () => {});
    const processPendingScan = vi.fn(() => new Promise<void>(() => {}));

    const response = await handleQrInterceptorRequest(RESTAURANT_ID, "7", {
      lookup,
      enqueueScan,
      processPendingScan,
      generateScanId: () => SCAN_ID,
      scanTimeoutMs: 10,
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://esborder.qs.esb.co.id/APP/1294/order?mode=dinein&tableNumber=7",
    );
    expect(enqueueScan).toHaveBeenCalledWith(SCAN_ID, RESTAURANT_ID, 7);
    expect(processPendingScan).toHaveBeenCalledWith(SCAN_ID);
  });
});

describe("M-03 production source contract", () => {
  const source = () =>
    readFileSync(new URL("../src/lib/qr-interceptor.server.ts", import.meta.url), "utf8");

  it("uses service-role-only enqueue and processor RPCs in the default flow", () => {
    expect(source()).toMatch(/client\.rpc\("enqueue_qr_scan"/);
    expect(source()).toMatch(/client\.rpc\("process_pending_qr_scan"/);
    expect(source()).toMatch(/randomUUID\(\)/);
  });
});
