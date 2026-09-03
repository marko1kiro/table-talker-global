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

export const defaultDeclineQrScan = async (scanId: string): Promise<void> => {
  const client = getServiceClient();
  if (!client) throw new Error("QR_DATABASE_UNAVAILABLE");
  const { error } = await client.rpc("decline_qr_scan", { p_scan_id: scanId });
  if (error) throw error;
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

  const esbUrl = `${ESB_BASE_URL}/APP/${encodeURIComponent(resolved.esbAppId)}/order?mode=dinein&tableNumber=${resolved.tableNumber}`;
  return confirmationPageResponse(resolved.tableNumber, scanId, esbUrl);
}

function pageResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function confirmationPageResponse(tableNumber: number, scanId: string, esbUrl: string): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Konfirmasi Meja ${tableNumber}</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#0f172a;background:#f8fafc}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    .card{max-width:460px;width:100%;border:0;border-radius:24px;background:white;padding:32px;box-shadow:0 20px 60px #0f172a22;text-align:center;box-sizing:border-box}
    .meja{font-size:15px;font-weight:800;letter-spacing:.12em;color:#b45309;margin:0}
    .nomor{font-size:64px;font-weight:900;line-height:1.1;margin:4px 0 18px}
    .pesan{font-size:19px;font-weight:700;line-height:1.55;margin:0 0 26px}
    .ya{display:flex;min-height:80px;align-items:center;justify-content:center;width:100%;box-sizing:border-box;border:0;border-radius:18px;background:#f59e0b;color:#0f172a;font-size:26px;font-weight:900;text-decoration:none;cursor:pointer}
    .ya:active{transform:scale(.98)}
    .tidak{margin-top:18px}
    .tidak button{min-height:48px;width:100%;box-sizing:border-box;border:2px solid #e2e8f0;border-radius:14px;background:white;color:#475569;font-size:16px;font-weight:700;cursor:pointer}
    .hint{margin-top:20px;font-size:13px;font-weight:600;color:#94a3b8;line-height:1.5}
  </style>
</head>
<body>
  <div class="card">
    <p class="meja">MEJA</p>
    <p class="nomor">${tableNumber}</p>
    <p class="pesan">Anda akan memesan di Meja Nomor ${tableNumber}. Mohon untuk tidak berpindah Meja agar makanan tidak tertukar dengan pesanan lainnya.</p>
    <a class="ya" href="${esbUrl}">YA, SAYA MAU PESAN</a>
    <form class="tidak" method="post" action="/q/decline">
      <input type="hidden" name="scan_id" value="${scanId}">
      <button type="submit">Saya pindah meja</button>
    </form>
    <p class="hint">Salah tekan atau pindah meja? Scan ulang QR di meja kamu.</p>
  </div>
</body>
</html>`;
  return pageResponse(html);
}

export function declinedPageResponse(): Response {
  const html = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Meja dibatalkan</title>
  <style>
    :root{font-family:system-ui,sans-serif;color:#0f172a;background:#f8fafc}
    body{min-height:100vh;margin:0;display:grid;place-items:center;padding:24px;box-sizing:border-box}
    .card{max-width:460px;width:100%;border:0;border-radius:24px;background:white;padding:32px;box-shadow:0 20px 60px #0f172a22;text-align:center;box-sizing:border-box}
    .pesan{font-size:22px;font-weight:800;line-height:1.5;margin:0 0 14px}
    .sub{font-size:15px;font-weight:600;color:#64748b;line-height:1.6;margin:0}
  </style>
</head>
<body>
  <div class="card">
    <p class="pesan">Meja dibatalkan. Silakan scan QR di meja baru ya, Kak.</p>
    <p class="sub">Meja sebelumnya sudah kami bebaskan secara otomatis.</p>
  </div>
</body>
</html>`;
  return pageResponse(html);
}
