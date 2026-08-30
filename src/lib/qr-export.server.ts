import { requireSuperAdmin } from "./auth.server";
import { buildQrExportRows } from "./qr-export-domain";
import { getServiceClient } from "./remote-audio.server";

// ESB App ID Panel + QR Link Export -- see docs/superpowers/specs/
// 2026-08-30-esb-app-id-panel-qr-export-design.md, decisions 2 and 4, and
// §6's suggested implementation shape. This module builds the two
// distinct downloadable exports (.xlsx via `write-excel-file`, .csv via
// plain string building) for a single restaurant's 100 QR Interceptor
// URLs, then serveQrExport() wraps that into a raw binary Response with
// the correct headers -- mirroring src/lib/restaurant-audio.server.ts's
// existing raw-Response pattern.

// Decision 2: the domain is user-editable in the export UI and never
// persisted -- this is only the pre-filled default shown to the Super
// Admin, matching the QR Interceptor's current (temporary, per Open
// Decision 2 of the original spec) domain.
export const DEFAULT_QR_EXPORT_DOMAIN = "https://qr.xdirga.xyz";

export type QrExportFormat = "xlsx" | "csv";

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildQrExportCsv(restaurantId: string, domain: string): string {
  const rows = buildQrExportRows(restaurantId, domain);
  const lines = [
    "table_number,url",
    ...rows.map((row) => `${row.tableNumber},${csvEscape(row.url)}`),
  ];
  return `${lines.join("\n")}\n`;
}

export async function buildQrExportXlsxBuffer(
  restaurantId: string,
  domain: string,
): Promise<Buffer> {
  const writeXlsxFile = (await import("write-excel-file/node")).default;
  const rows = buildQrExportRows(restaurantId, domain);
  const sheetData = [
    [
      { value: "Nomor Meja", type: String },
      { value: "URL QR", type: String },
    ],
    ...rows.map((row) => [
      { value: row.tableNumber, type: Number },
      { value: row.url, type: String },
    ]),
  ];
  return writeXlsxFile(sheetData).toBuffer();
}

function response(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function slugifyFileNamePart(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "resto"
  );
}

export type RestaurantExportLookupResult = { displayName: string } | null;
export type RestaurantExportLookup = (
  restaurantId: string,
) => Promise<RestaurantExportLookupResult>;

export const defaultRestaurantExportLookup: RestaurantExportLookup = async (restaurantId) => {
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client
    .from("restaurants")
    .select("display_name")
    .eq("id", restaurantId)
    .maybeSingle();
  if (error || !data) return null;
  return { displayName: data.display_name as string };
};

export type ServeQrExportInput = {
  restaurantId: string;
  format: QrExportFormat;
  domain?: string;
};

export type ServeQrExportDeps = {
  requireAuth?: () => Promise<unknown>;
  lookup?: RestaurantExportLookup;
};

// ---------------------------------------------------------------------------
// serveQrExport -- the full flow: light super-admin auth -> restaurant
// lookup (for the filename) -> build the requested format -> raw binary
// Response with correct Content-Type/Content-Disposition/Cache-Control.
// Never leaks internal error detail on failure, mirroring
// handleQrInterceptorRequest's contract.
// ---------------------------------------------------------------------------
export async function serveQrExport(
  { restaurantId, format, domain }: ServeQrExportInput,
  {
    requireAuth = requireSuperAdmin,
    lookup = defaultRestaurantExportLookup,
  }: ServeQrExportDeps = {},
): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return response("Tidak diizinkan.", 401);
  }

  if (format !== "xlsx" && format !== "csv") {
    return response("Format export tidak dikenal.", 400);
  }

  let restaurant: RestaurantExportLookupResult;
  try {
    restaurant = await lookup(restaurantId);
  } catch {
    restaurant = null;
  }
  if (!restaurant) return response("Resto tidak ditemukan.", 404);

  const resolvedDomain = domain?.trim() || DEFAULT_QR_EXPORT_DOMAIN;
  const fileNameBase = `qr-export-${slugifyFileNamePart(restaurant.displayName)}`;

  if (format === "csv") {
    const csv = buildQrExportCsv(restaurantId, resolvedDomain);
    return new Response(csv, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileNameBase}.csv"`,
      },
    });
  }

  const buffer = await buildQrExportXlsxBuffer(restaurantId, resolvedDomain);
  const body = new Uint8Array(buffer);
  return new Response(body, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileNameBase}.xlsx"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}
