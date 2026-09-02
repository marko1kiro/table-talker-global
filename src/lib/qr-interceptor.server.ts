import { randomUUID } from "node:crypto";
import { getServiceClient } from "./remote-audio.server";
import { recordQrScanCore, type RecordQrScanResult } from "./table-occupancy.server";

// Task 7: QR Interceptor -- see docs/superpowers/plans/
// 2026-08-29-table-occupancy-tracking.md, Task 7. This module is the
// server-only implementation behind the raw API route at
// src/routes/api/qr/$restaurantId/$tableNumber.ts.
//
// The customer endpoint deliberately has no login. All database calls made
// here use RPCs granted only to service_role; no bearer token is accepted or
// forwarded.

const ESB_BASE_URL = "https://esborder.qs.esb.co.id";

export type RestaurantEsbConfig = { esbAppId: string | null; isActive: boolean };

export type RestaurantEsbLookup = (restaurantId: string) => Promise<RestaurantEsbConfig | null>;

export type RecordQrScanFn = (
  restaurantId: string,
  tableNumber: number,
) => Promise<RecordQrScanResult>;

export type EnqueueQrScanFn = (
  scanId: string,
  restaurantId: string,
  tableNumber: number,
) => Promise<void>;

export type ProcessPendingQrScanFn = (scanId: string) => Promise<void>;

export type ResolveEsbRedirectResult =
  | { ok: true; url: string }
  | { ok: false; code: "RESTAURANT_NOT_FOUND" | "RESTAURANT_INACTIVE" | "MISSING_ESB_APP_ID" };

export async function resolveEsbRedirectUrl(
  restaurantId: string,
  tableNumber: number,
  lookup: RestaurantEsbLookup,
): Promise<ResolveEsbRedirectResult> {
  let config: RestaurantEsbConfig | null;
  try {
    config = await lookup(restaurantId);
  } catch {
    return { ok: false, code: "RESTAURANT_NOT_FOUND" };
  }
  if (!config) return { ok: false, code: "RESTAURANT_NOT_FOUND" };
  if (!config.isActive) return { ok: false, code: "RESTAURANT_INACTIVE" };
  if (!config.esbAppId) return { ok: false, code: "MISSING_ESB_APP_ID" };

  const url = `${ESB_BASE_URL}/APP/${encodeURIComponent(config.esbAppId)}/order?mode=dinein&tableNumber=${tableNumber}`;
  return { ok: true, url };
}

export const defaultRestaurantEsbLookup: RestaurantEsbLookup = async (restaurantId) => {
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("restaurants")
    .select("esb_app_id, is_active")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    esbAppId: (data.esb_app_id as string | null) ?? null,
    isActive: Boolean(data.is_active),
  };
};

// Retained as a compatibility wrapper for direct callers. The interceptor's
// production path below uses the durable enqueue + processor flow instead.
export const defaultRecordQrScan: RecordQrScanFn = async (restaurantId, tableNumber) => {
  const client = getServiceClient();
  if (!client) {
    return { ok: false, code: "UNAVAILABLE", message: "Gagal memproses permintaan meja." };
  }
  return recordQrScanCore({ restaurantId, tableNumber }, async (fn, params) =>
    client.rpc(fn, params),
  );
};

export const defaultEnqueueQrScan: EnqueueQrScanFn = async (scanId, restaurantId, tableNumber) => {
  const client = getServiceClient();
  if (!client) throw new Error("QR_SCAN_OUTBOX_UNAVAILABLE");
  const { error } = await client.rpc("enqueue_qr_scan", {
    p_scan_id: scanId,
    p_restaurant_id: restaurantId,
    p_table_number: tableNumber,
  });
  if (error) throw error;
};

export const defaultProcessPendingQrScan: ProcessPendingQrScanFn = async (scanId) => {
  const client = getServiceClient();
  if (!client) throw new Error("QR_SCAN_PROCESSOR_UNAVAILABLE");
  const { error } = await client.rpc("process_pending_qr_scan", { p_scan_id: scanId });
  if (error) throw error;
};

function notFound(): Response {
  return new Response("Resto tidak ditemukan.", {
    status: 404,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function parseTableNumber(raw: string): number | null {
  if (!/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= 100 ? n : null;
}

const DEFAULT_SCAN_TIMEOUT_MS = 1500;

async function recordScanBestEffort(
  recordScan: RecordQrScanFn,
  restaurantId: string,
  tableNumber: number,
  timeoutMs: number,
): Promise<void> {
  try {
    await Promise.race([
      recordScan(restaurantId, tableNumber),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Fail-open: compatibility callers must never block the redirect.
  }
}

export async function persistQrScanBestEffort(
  scanId: string,
  restaurantId: string,
  tableNumber: number,
  enqueueScan: EnqueueQrScanFn,
  processPendingScan: ProcessPendingQrScanFn,
  timeoutMs: number,
): Promise<void> {
  try {
    await Promise.race([
      (async () => {
        // Processing is intentionally sequenced after the durable insert. If
        // it times out, the database scheduler can safely retry this scan ID.
        await enqueueScan(scanId, restaurantId, tableNumber);
        await processPendingScan(scanId);
      })(),
      new Promise((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Fail-open: database failures never block or fail the customer redirect.
  }
}

export type HandleQrInterceptorRequestDeps = {
  lookup?: RestaurantEsbLookup;
  enqueueScan?: EnqueueQrScanFn;
  processPendingScan?: ProcessPendingQrScanFn;
  generateScanId?: () => string;
  scanTimeoutMs?: number;
  // Compatibility injection for the pre-M-03 unit tests. Production callers
  // omit it and therefore cannot bypass the durable outbox path.
  recordScan?: RecordQrScanFn;
};

export async function handleQrInterceptorRequest(
  restaurantIdRaw: string,
  tableNumberRaw: string,
  {
    lookup = defaultRestaurantEsbLookup,
    enqueueScan = defaultEnqueueQrScan,
    processPendingScan = defaultProcessPendingQrScan,
    generateScanId = () => randomUUID(),
    scanTimeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
    recordScan,
  }: HandleQrInterceptorRequestDeps = {},
): Promise<Response> {
  if (!isValidUuid(restaurantIdRaw)) return notFound();
  const tableNumber = parseTableNumber(tableNumberRaw);
  if (tableNumber === null) return notFound();

  const resolved = await resolveEsbRedirectUrl(restaurantIdRaw, tableNumber, lookup);

  // Unknown UUIDs are skipped. Existing inactive/misconfigured restaurants
  // still attempt the durable RPC, whose active-restaurant guard is
  // authoritative and will reject an inactive restaurant.
  if (resolved.ok || resolved.code !== "RESTAURANT_NOT_FOUND") {
    if (recordScan) {
      await recordScanBestEffort(recordScan, restaurantIdRaw, tableNumber, scanTimeoutMs);
    } else {
      await persistQrScanBestEffort(
        generateScanId(),
        restaurantIdRaw,
        tableNumber,
        enqueueScan,
        processPendingScan,
        scanTimeoutMs,
      );
    }
  }

  if (!resolved.ok) return notFound();

  return new Response(null, {
    status: 302,
    headers: { Location: resolved.url, "Cache-Control": "no-store" },
  });
}
