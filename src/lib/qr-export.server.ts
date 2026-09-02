import { randomBytes, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { buildQrExportRows } from "./qr-export-domain";
import {
  deletePrivateQrExportObject,
  readPrivateQrExportObject,
  uploadPrivateR2Object,
} from "./r2.server";
import { getServiceClient } from "./remote-audio.server";

export const DEFAULT_QR_EXPORT_DOMAIN = "https://qr.xdirga.xyz";
export type QrExportFormat = "xlsx" | "csv";
export type QrGenerationScope = "all" | "selected";
export type DynamicQrRow = { tableNumber: number; token: string };

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function normalizedDomain(domain: string): string {
  return domain.trim().replace(/\/+$/, "");
}

// Compatibility builders retained for non-physical legacy callers. New QR
// generation exclusively uses the opaque builders below.
export function buildQrExportCsv(restaurantId: string, domain: string): string {
  const rows = buildQrExportRows(restaurantId, domain);
  return `${["table_number,url", ...rows.map((row) => `${row.tableNumber},${csvEscape(row.url)}`)].join("\n")}\n`;
}

export async function buildQrExportXlsxBuffer(
  restaurantId: string,
  domain: string,
): Promise<Buffer> {
  const rows = buildQrExportRows(restaurantId, domain).map((row) => ({
    tableNumber: row.tableNumber,
    url: row.url,
  }));
  return buildXlsx(rows);
}

export function normalizeQrGenerationSelection(
  scope: QrGenerationScope,
  tableNumbers: number[],
): number[] {
  if (scope === "all") return Array.from({ length: 100 }, (_, index) => index + 1);
  if (scope !== "selected") throw new Error("Cakupan QR tidak valid.");
  const normalized = [...new Set(tableNumbers)].sort((a, b) => a - b);
  if (
    normalized.length === 0 ||
    normalized.length > 100 ||
    normalized.some((value) => !Number.isInteger(value) || value < 1 || value > 100)
  ) {
    throw new Error("Pilih minimal satu meja yang valid.");
  }
  return normalized;
}

export function buildDynamicQrExportCsv(rows: DynamicQrRow[], domain: string): string {
  const base = normalizedDomain(domain);
  return `${[
    "table_number,url",
    ...rows.map((row) => `${row.tableNumber},${csvEscape(`${base}/q/${row.token}`)}`),
  ].join("\n")}\n`;
}

async function buildXlsx(rows: Array<{ tableNumber: number; url: string }>): Promise<Buffer> {
  const writeXlsxFile = (await import("write-excel-file/node")).default;
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

export async function buildDynamicQrExportXlsxBuffer(
  rows: DynamicQrRow[],
  domain: string,
): Promise<Buffer> {
  const base = normalizedDomain(domain);
  return buildXlsx(
    rows.map((row) => ({ tableNumber: row.tableNumber, url: `${base}/q/${row.token}` })),
  );
}

export function qrExportKey(restaurantId: string, batchId: string, format: QrExportFormat): string {
  return `qr-exports/${restaurantId}/${batchId}/qr-codes.${format}`;
}

export type CommitQrBatchInput = {
  batchId: string;
  restaurantId: string;
  createdBy: string;
  domain: string;
  scope: QrGenerationScope;
  tableNumbers: number[];
  tokens: string[];
  r2KeyXlsx: string;
  r2KeyCsv: string;
};

type GenerateQrBatchInput = {
  restaurantId: string;
  domain: string;
  scope: QrGenerationScope;
  tableNumbers: number[];
  createdBy: string;
};

type GenerateQrBatchDeps = {
  generateBatchId?: () => string;
  generateToken?: (tableNumber: number) => string;
  upload?: (key: string, body: Uint8Array | string, contentType: string) => Promise<void>;
  remove?: (key: string) => Promise<void>;
  commit?: (input: CommitQrBatchInput) => Promise<void>;
};

async function defaultCommitQrBatch(input: CommitQrBatchInput): Promise<void> {
  const client = getServiceClient();
  if (!client) throw new Error("Database tidak tersedia.");
  const { error } = await client.rpc("commit_qr_export_batch", {
    p_batch_id: input.batchId,
    p_restaurant_id: input.restaurantId,
    p_created_by: input.createdBy,
    p_domain_used: input.domain,
    p_scope: input.scope,
    p_table_numbers: input.tableNumbers,
    p_tokens: input.tokens,
    p_r2_key_xlsx: input.r2KeyXlsx,
    p_r2_key_csv: input.r2KeyCsv,
  });
  if (error) throw error;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

export async function generateQrBatchCore(
  input: GenerateQrBatchInput,
  {
    generateBatchId = () => randomUUID(),
    generateToken = () => randomBytes(32).toString("base64url"),
    upload = uploadPrivateR2Object,
    remove = deletePrivateQrExportObject,
    commit = defaultCommitQrBatch,
  }: GenerateQrBatchDeps = {},
): Promise<CommitQrBatchInput> {
  const tableNumbers = normalizeQrGenerationSelection(input.scope, input.tableNumbers);
  const domain = normalizedDomain(input.domain);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const batchId = generateBatchId();
    const tokens = tableNumbers.map((tableNumber) => generateToken(tableNumber));
    const rows = tableNumbers.map((tableNumber, index) => ({
      tableNumber,
      token: tokens[index],
    }));
    const r2KeyXlsx = qrExportKey(input.restaurantId, batchId, "xlsx");
    const r2KeyCsv = qrExportKey(input.restaurantId, batchId, "csv");
    const [xlsx, csv] = await Promise.all([
      buildDynamicQrExportXlsxBuffer(rows, domain),
      Promise.resolve(buildDynamicQrExportCsv(rows, domain)),
    ]);

    const attemptedKeys: string[] = [];
    const commitInput: CommitQrBatchInput = {
      batchId,
      restaurantId: input.restaurantId,
      createdBy: input.createdBy,
      domain,
      scope: input.scope,
      tableNumbers,
      tokens,
      r2KeyXlsx,
      r2KeyCsv,
    };
    try {
      // Deliberately sequential: a database commit is impossible until both
      // encrypted objects have completed successfully.
      attemptedKeys.push(r2KeyXlsx);
      await upload(
        r2KeyXlsx,
        new Uint8Array(xlsx),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      attemptedKeys.push(r2KeyCsv);
      await upload(r2KeyCsv, csv, "text/csv; charset=utf-8");
      await commit(commitInput);
      return commitInput;
    } catch (error) {
      // Delete every attempted key: an upload can reach R2 even if its response
      // is interrupted. Do not retry until cleanup succeeds.
      for (const key of attemptedKeys) await remove(key);
      if (!isUniqueViolation(error) || attempt === 2) throw error;
    }
  }
  throw new Error("Token QR tidak dapat dibuat.");
}

const generateSchema = z.object({
  restaurantId: z.string().uuid(),
  domain: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value)),
  scope: z.enum(["all", "selected"]),
  tableNumbers: z.array(z.number().int().min(1).max(100)).max(100),
  superAdminPassword: z.string().min(1).max(200),
});

export const generateQrExport = createServerFn({ method: "POST" })
  .inputValidator(generateSchema)
  .handler(async ({ data }) => {
    const { requireRecentSuperAdmin } = await import("./auth.server");
    await requireRecentSuperAdmin(data.superAdminPassword);
    const result = await generateQrBatchCore({
      restaurantId: data.restaurantId,
      domain: data.domain,
      scope: data.scope,
      tableNumbers: data.tableNumbers,
      createdBy: "super-admin",
    });
    return { ok: true as const, batchId: result.batchId };
  });

export type QrBatchHistoryRow = {
  id: string;
  created_at: string;
  created_by: string;
  domain_used: string;
  scope: QrGenerationScope;
  table_numbers: number[];
  status: "ACTIVE" | "EXPIRED" | "SEBAGIAN AKTIF";
};

export const listQrExportHistory = createServerFn({ method: "GET" })
  .inputValidator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false as const, error: "Database tidak tersedia." };
    const result = await client.rpc("list_qr_export_batches", {
      p_restaurant_id: data.restaurantId,
    });
    if (result.error) return { ok: false as const, error: "Riwayat QR tidak dapat dimuat." };
    return { ok: true as const, batches: (result.data ?? []) as QrBatchHistoryRow[] };
  });

function response(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
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

// Legacy response function retained for compatibility tests and non-physical
// exports; the production download route uses serveQrBatchDownload below.
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

export async function serveQrExport(
  {
    restaurantId,
    format,
    domain,
  }: { restaurantId: string; format: QrExportFormat; domain?: string },
  {
    requireAuth = requireSuperAdmin,
    lookup = defaultRestaurantExportLookup,
  }: { requireAuth?: () => Promise<unknown>; lookup?: RestaurantExportLookup } = {},
): Promise<Response> {
  try {
    await requireAuth();
  } catch {
    return response("Tidak diizinkan.", 401);
  }
  if (format !== "xlsx" && format !== "csv") return response("Format export tidak dikenal.", 400);
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
    return new Response(buildQrExportCsv(restaurantId, resolvedDomain), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileNameBase}.csv"`,
      },
    });
  }
  const buffer = await buildQrExportXlsxBuffer(restaurantId, resolvedDomain);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileNameBase}.xlsx"`,
      "Content-Length": String(buffer.byteLength),
    },
  });
}

export async function serveQrBatchDownload(
  batchId: string,
  format: QrExportFormat,
): Promise<Response> {
  try {
    await requireSuperAdmin();
  } catch {
    return response("Tidak diizinkan.", 401);
  }
  if (format !== "xlsx" && format !== "csv") return response("Format export tidak dikenal.", 400);
  const client = getServiceClient();
  if (!client) return response("File tidak tersedia.", 503);
  const result = await client.rpc("get_qr_export_key", {
    p_batch_id: batchId,
    p_format: format,
  });
  const key = typeof result.data === "string" ? result.data : null;
  if (result.error || !key) return response("File tidak ditemukan.", 404);
  try {
    const bytes = await readPrivateQrExportObject(key);
    const contentType =
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8";
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    return new Response(body.buffer, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="qr-codes-${batchId}.${format}"`,
      },
    });
  } catch {
    return response("File tidak tersedia.", 503);
  }
}
