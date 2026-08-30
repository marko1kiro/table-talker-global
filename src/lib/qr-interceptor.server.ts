import { getServiceClient } from "./remote-audio.server";
import { recordQrScanCore, type RecordQrScanResult } from "./table-occupancy.server";

// Task 7: QR Interceptor -- see docs/superpowers/plans/
// 2026-08-29-table-occupancy-tracking.md, Task 7. This module is the
// server-only implementation behind the raw API route at
// src/routes/api/qr/$restaurantId/$tableNumber.ts (see that file for why
// the path segment is the restaurant's UUID `id`, not a "slug" -- no such
// column exists anywhere in the restaurants schema read for this feature).
//
// Every RPC this module touches (`record_qr_scan`) is `grant execute ...
// to service_role` only (supabase/migrations/20260829020000_
// table_occupancy_rpcs.sql) -- the opposite grant shape from the other six
// Task 6 RPCs -- so, unlike table-occupancy.server.ts's other wrappers,
// this module correctly uses the plain service-role client throughout.
// This endpoint is hit directly by customers' phones with no login, so it
// deliberately never accepts or forwards a bearer/access token.

const ESB_BASE_URL = "https://esborder.qs.esb.co.id";

export type RestaurantEsbConfig = { esbAppId: string | null; isActive: boolean };

export type RestaurantEsbLookup = (restaurantId: string) => Promise<RestaurantEsbConfig | null>;

export type RecordQrScanFn = (
  restaurantId: string,
  tableNumber: number,
) => Promise<RecordQrScanResult>;

export type ResolveEsbRedirectResult =
  | { ok: true; url: string }
  | { ok: false; code: "RESTAURANT_NOT_FOUND" | "RESTAURANT_INACTIVE" | "MISSING_ESB_APP_ID" };

// ---------------------------------------------------------------------------
// resolveEsbRedirectUrl -- pure, dependency-injected core (mirrors the
// Core-fn pattern used throughout src/lib/*.server.ts): looks up the
// restaurant's esb_app_id via an injected lookup function and builds the
// real ESB order URL. Never throws -- any lookup failure is folded into
// RESTAURANT_NOT_FOUND so the caller never leaks internal error detail.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// defaultRestaurantEsbLookup -- production RestaurantEsbLookup implementation,
// backed by the plain service-role client (restaurants is `revoke all ...
// from anon, authenticated`, readable only server-side).
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// defaultRecordQrScan -- production RecordQrScanFn, reusing recordQrScanCore
// from table-occupancy.server.ts (built in Task 6) rather than
// re-implementing the record_qr_scan RPC call, per the plan's Task 7 Step 3
// note.
// ---------------------------------------------------------------------------
export const defaultRecordQrScan: RecordQrScanFn = async (restaurantId, tableNumber) => {
  const client = getServiceClient();
  if (!client) {
    return { ok: false, code: "UNAVAILABLE", message: "Gagal memproses permintaan meja." };
  }
  return recordQrScanCore({ restaurantId, tableNumber }, async (fn, params) =>
    client.rpc(fn, params),
  );
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

// Bounded budget for the fire-and-await scan log per the spec's fail-open
// contract ("if it must be awaited for correctness, its budget is bounded
// and any failure is swallowed -- the redirect always proceeds").
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
    // Fail-open: logging failures never block or fail the customer's redirect.
  }
}

export type HandleQrInterceptorRequestDeps = {
  lookup?: RestaurantEsbLookup;
  recordScan?: RecordQrScanFn;
  scanTimeoutMs?: number;
};

// ---------------------------------------------------------------------------
// handleQrInterceptorRequest -- the full fail-open flow described in the
// spec's QR Interceptor section: parse -> resolve ESB URL -> best-effort
// scan log (bounded, swallowed on failure) -> 302. Unknown/inactive/
// misconfigured restaurants and malformed params all fall back to a plain
// 404 that never leaks internal error detail, per the plan's Task 7 Step 1b.
// ---------------------------------------------------------------------------
export async function handleQrInterceptorRequest(
  restaurantIdRaw: string,
  tableNumberRaw: string,
  {
    lookup = defaultRestaurantEsbLookup,
    recordScan = defaultRecordQrScan,
    scanTimeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
  }: HandleQrInterceptorRequestDeps = {},
): Promise<Response> {
  if (!isValidUuid(restaurantIdRaw)) return notFound();
  const tableNumber = parseTableNumber(tableNumberRaw);
  if (tableNumber === null) return notFound();

  const resolved = await resolveEsbRedirectUrl(restaurantIdRaw, tableNumber, lookup);

  // Only log a scan once we know the restaurant genuinely exists -- an
  // unknown restaurant id would make record_qr_scan raise the identical
  // RESTAURANT_NOT_FOUND anyway, so skipping it avoids a pointless RPC call
  // on obviously-invalid/scanned garbage.
  if (resolved.ok || resolved.code !== "RESTAURANT_NOT_FOUND") {
    await recordScanBestEffort(recordScan, restaurantIdRaw, tableNumber, scanTimeoutMs);
  }

  if (!resolved.ok) return notFound();

  return new Response(null, {
    status: 302,
    headers: { Location: resolved.url, "Cache-Control": "no-store" },
  });
}
