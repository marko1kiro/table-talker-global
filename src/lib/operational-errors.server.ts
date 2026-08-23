import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import {
  normalizeHistoryRange,
  normalizeHistorySearch,
  validateResolutionNote,
} from "./owner-history-domain";
import { getServiceClient } from "./remote-audio.server";

const OPERATIONS_ERROR_CODES = new Set([
  "tenant_login",
  "sync_cache",
  "playback",
  "realtime",
  "r2_upload",
  "rpc",
  "server",
]);
const OPERATIONS_REPORT_CODES = new Set([
  "tenant_login",
  "sync_cache",
  "playback",
  "realtime",
  "r2_upload",
  "rpc",
  "server",
  "SYNC_MANIFEST",
  "SYNC_OFFLINE",
  "SYNC_CACHE",
  "SYNC_DOWNLOAD",
]);

const errorReportSchema = z.object({
  stage: z.string().max(60),
  reportCode: z.string().max(60),
  detail: z.string().max(1000).nullable().optional(),
  deviceId: z.string().max(200).nullable().optional(),
  crewSessionId: z.string().max(200).nullable().optional(),
});

export const reportOperationalError = createServerFn({ method: "POST" })
  .validator(
    z.object({
      tenantToken: z.string(),
      crewSessionToken: z.string().optional(),
      error: errorReportSchema,
    }),
  )
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { ok: false as const };
    const { hashTenantSession, verifyActiveTenantSession, verifyCrewSessionToken } =
      await import("./tenant-session.server");
    const tenant = await verifyActiveTenantSession(client, data.tenantToken);
    if (
      !tenant ||
      !OPERATIONS_ERROR_CODES.has(data.error.stage) ||
      !OPERATIONS_REPORT_CODES.has(data.error.reportCode)
    )
      return { ok: false as const };
    if (data.error.crewSessionId) {
      if (!data.crewSessionToken) return { ok: false as const };
      const session = await verifyCrewSessionToken(
        client,
        data.crewSessionToken,
        tenant.restaurantId,
      );
      if (!session || session.crewSessionId !== data.error.crewSessionId)
        return { ok: false as const };
    }

    try {
      const { data: allowed } = await client.rpc("check_operational_error_rate_limit", {
        p_key_hash: hashTenantSession(data.crewSessionToken ?? data.tenantToken),
      });
      if (!allowed) return { ok: false as const };
      const { error } = await client.from("operational_errors").insert({
        restaurant_id: tenant.restaurantId,
        stage: data.error.stage,
        report_code: data.error.reportCode,
        detail: data.error.detail?.replace(/[^\x20-\x7E]/g, " ").slice(0, 500) ?? null,
        device_id: data.error.deviceId ?? null,
        crew_session_id: data.error.crewSessionId ?? null,
      });

      return error ? { ok: false as const } : { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });

const operationalErrorListSchema = z.object({
  restaurantId: z.string().uuid().optional(),
  stage: z.string().trim().max(60).optional(),
  reportCode: z.string().trim().max(60).optional(),
  resolved: z.boolean().optional(),
  text: z.string().max(101).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.number().int().min(1).default(1),
});

const ERROR_PAGE_SIZE = 50;

export const listOperationalErrors = createServerFn({ method: "GET" })
  .validator(operationalErrorListSchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const range = normalizeHistoryRange(data);
    if (!range.ok)
      return { ok: false as const, code: range.code, message: "Rentang tanggal tidak valid." };
    const search = normalizeHistorySearch(data.text);
    if (!search.ok)
      return { ok: false as const, code: search.code, message: "Pencarian terlalu panjang." };
    const client = getServiceClient();
    if (!client)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Error Log tidak tersedia.",
      };
    const offset = (data.page - 1) * ERROR_PAGE_SIZE;

    try {
      let query = client
        .from("operational_errors")
        .select(
          "id,restaurant_id,stage,report_code,detail,device_id,crew_session_id,occurred_at,resolved_at,resolved_by,resolution_note",
          { count: "exact" },
        )
        .gte("occurred_at", range.from)
        .lte("occurred_at", range.to)
        .order("occurred_at", { ascending: false })
        .range(offset, offset + ERROR_PAGE_SIZE - 1);
      if (data.restaurantId) query = query.eq("restaurant_id", data.restaurantId);
      if (data.stage) query = query.eq("stage", data.stage.trim());
      if (data.reportCode) query = query.eq("report_code", data.reportCode.trim());
      if (data.resolved === true) query = query.not("resolved_at", "is", null);
      if (data.resolved === false) query = query.is("resolved_at", null);
      if (search.text)
        query = query.or(`report_code.ilike.%${search.text}%,detail.ilike.%${search.text}%`);
      const { data: errors, count, error } = await query;
      if (error)
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Error Log tidak tersedia.",
        };
      return {
        ok: true as const,
        errors: errors ?? [],
        page: data.page,
        total: count ?? 0,
        nextPage: offset + ERROR_PAGE_SIZE < (count ?? 0) ? data.page + 1 : null,
      };
    } catch {
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Error Log tidak tersedia.",
      };
    }
  });

export const resolveOperationalError = createServerFn({ method: "POST" })
  .validator(z.object({ errorId: z.string().uuid(), note: z.string().max(1001).optional() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const note = validateResolutionNote(data.note);
    if (!note.ok)
      return { ok: false as const, code: note.code, message: "Catatan maksimal 1000 karakter." };
    const client = getServiceClient();
    if (!client)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Error Log tidak tersedia.",
      };

    try {
      const { data: existing, error: lookupError } = await client
        .from("operational_errors")
        .select("id,resolved_at")
        .eq("id", data.errorId)
        .maybeSingle();
      if (lookupError)
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Error Log tidak tersedia.",
        };
      if (!existing)
        return {
          ok: false as const,
          code: "NOT_FOUND" as const,
          message: "Error tidak ditemukan.",
        };
      if (existing.resolved_at)
        return {
          ok: false as const,
          code: "ALREADY_RESOLVED" as const,
          message: "Error sudah diselesaikan.",
        };
      const { data: resolved, error } = await client
        .from("operational_errors")
        .update({
          resolved_at: new Date().toISOString(),
          resolved_by: "super-admin",
          resolution_note: note.note,
        })
        .eq("id", data.errorId)
        .is("resolved_at", null)
        .select("id")
        .maybeSingle();
      if (error)
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Error gagal diselesaikan.",
        };
      if (!resolved)
        return {
          ok: false as const,
          code: "ALREADY_RESOLVED" as const,
          message: "Error sudah diselesaikan.",
        };
      return { ok: true as const };
    } catch {
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Error gagal diselesaikan.",
      };
    }
  });
