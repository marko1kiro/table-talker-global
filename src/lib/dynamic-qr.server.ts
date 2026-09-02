import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { defaultProcessPendingQrScan, type ProcessPendingQrScanFn } from "./qr-interceptor.server";
import { getServiceClient } from "./remote-audio.server";

const ESB_BASE_URL = "https://esborder.qs.esb.co.id";
const DEFAULT_SCAN_TIMEOUT_MS = 1500;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const INVALID_QR_MESSAGE = "SILAKAN PESAN DI KASIR YA KAK, QR MEJA INI SEDANG GANGGUAN";

export type ResolvedOpaqueQr = {
  restaurantId: string;
  tableNumber: number;
  esbAppId: string;
  enqueued: boolean;
};

export type ResolveAndEnqueueOpaqueQr = (
  scanId: string,
  token: string,
  ipHash: string,
) => Promise<ResolvedOpaqueQr | null>;

export const defaultResolveAndEnqueueOpaqueQr: ResolveAndEnqueueOpaqueQr = async (
  scanId,
  token,
  ipHash,
) => {
  const client = getServiceClient();
  if (!client) throw new Error("QR_DATABASE_UNAVAILABLE");
  const { data, error } = await client.rpc("resolve_and_enqueue_qr_scan", {
    p_scan_id: scanId,
    p_token: token,
    p_ip_hash: ipHash,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    restaurantId: String(row.restaurant_id),
    tableNumber: Number(row.table_number),
    esbAppId: String(row.esb_app_id),
    enqueued: Boolean(row.enqueued),
  };
};

export function trustedQrScannerIp(headers: Headers): string | null {
  // Vercel overwrites this canonical header at the trusted platform boundary.
  // Generic forwarded headers are intentionally ignored because clients can forge them.
  const candidate = headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return candidate.length <= 45 && isIP(candidate) ? candidate : null;
}

export function hashQrScannerIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex");
}

function invalidQrResponse(): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>QR meja sedang gangguan</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#0f172a;background:#f8fafc}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    dialog{position:static;max-width:420px;border:0;border-radius:20px;padding:28px;box-shadow:0 20px 60px #0f172a33;text-align:center}
    p{font-size:20px;font-weight:800;line-height:1.5;margin:0 0 22px}
    button{min-height:48px;border:0;border-radius:12px;background:#0f172a;color:white;font-weight:800;padding:0 28px;cursor:pointer}
  </style>
</head>
<body>
  <dialog open aria-labelledby="qr-message">
    <form method="dialog">
      <p id="qr-message">${INVALID_QR_MESSAGE}</p>
      <button type="submit">TUTUP</button>
    </form>
  </dialog>
</body>
</html>`;
  return new Response(html, {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function processDurableScanBestEffort(
  scanId: string,
  processPendingScan: ProcessPendingQrScanFn,
  timeoutMs: number,
): Promise<void> {
  try {
    await Promise.race([
      processPendingScan(scanId),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // The M-03 scheduler will reconcile the already-durable outbox row.
  }
}

export type HandleOpaqueQrRequestDeps = {
  resolveAndEnqueue?: ResolveAndEnqueueOpaqueQr;
  processPendingScan?: ProcessPendingQrScanFn;
  generateScanId?: () => string;
  scanTimeoutMs?: number;
};

export async function handleOpaqueQrRequest(
  token: string,
  headers: Headers,
  {
    resolveAndEnqueue = defaultResolveAndEnqueueOpaqueQr,
    processPendingScan = defaultProcessPendingQrScan,
    generateScanId = () => randomUUID(),
    scanTimeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
  }: HandleOpaqueQrRequestDeps = {},
): Promise<Response> {
  if (!TOKEN_PATTERN.test(token)) return invalidQrResponse();

  const scannerIp = trustedQrScannerIp(headers);
  if (!scannerIp) return invalidQrResponse();

  const scanId = generateScanId();
  let resolved: ResolvedOpaqueQr | null;
  try {
    resolved = await resolveAndEnqueue(scanId, token, hashQrScannerIp(scannerIp));
  } catch {
    return invalidQrResponse();
  }
  if (!resolved) return invalidQrResponse();

  if (resolved.enqueued) {
    await processDurableScanBestEffort(scanId, processPendingScan, scanTimeoutMs);
  }

  const url = `${ESB_BASE_URL}/APP/${encodeURIComponent(resolved.esbAppId)}/order?mode=dinein&tableNumber=${resolved.tableNumber}`;
  return new Response(null, {
    status: 302,
    headers: { Location: url, "Cache-Control": "no-store" },
  });
}
