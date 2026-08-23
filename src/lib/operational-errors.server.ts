import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { hashTenantSession, verifyActiveTenantSession, verifyCrewSessionToken } from "./tenant-session.server";

const OPERATIONS_ERROR_CODES = new Set([
  "tenant_login", "sync_cache", "playback", "realtime", "r2_upload", "rpc", "server",
]);
const OPERATIONS_REPORT_CODES = new Set([
  "tenant_login", "sync_cache", "playback", "realtime", "r2_upload", "rpc", "server",
  "SYNC_MANIFEST", "SYNC_OFFLINE", "SYNC_CACHE", "SYNC_DOWNLOAD",
]);

const errorReportSchema = z.object({
  stage: z.string().max(60),
  reportCode: z.string().max(60),
  detail: z.string().max(1000).nullable().optional(),
  deviceId: z.string().max(200).nullable().optional(),
  crewSessionId: z.string().max(200).nullable().optional(),
});

export const reportOperationalError = createServerFn({ method: "POST" })
  .validator(z.object({ tenantToken: z.string(), crewSessionToken: z.string().optional(), error: errorReportSchema }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { ok: false as const };
    const tenant = await verifyActiveTenantSession(client, data.tenantToken);
    if (!tenant || !OPERATIONS_ERROR_CODES.has(data.error.stage) || !OPERATIONS_REPORT_CODES.has(data.error.reportCode)) return { ok: false as const };
    if (data.error.crewSessionId) {
      if (!data.crewSessionToken) return { ok: false as const };
      const session = await verifyCrewSessionToken(client, data.crewSessionToken, tenant.restaurantId);
      if (!session || session.crewSessionId !== data.error.crewSessionId) return { ok: false as const };
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

export const listOperationalErrors = createServerFn({ method: "GET" })
  .validator(
    z.object({
      resolved: z.boolean().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { errors: [], total: 0 };

    try {
      let query = client
        .from("operational_errors")
        .select("*", { count: "exact" })
        .order("occurred_at", { ascending: false })
        .range(data.offset, data.offset + data.limit - 1);

      if (data.resolved !== undefined) {
        if (data.resolved) {
          query = query.not("resolved_at", "is", null);
        } else {
          query = query.is("resolved_at", null);
        }
      }

      const { data: errors, count, error } = await query;

      if (error) return { errors: [], total: 0 };

      return { errors: errors ?? [], total: count ?? 0 };
    } catch {
      return { errors: [], total: 0 };
    }
  });

export const resolveOperationalError = createServerFn({ method: "POST" })
  .validator(z.object({ errorId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { ok: false as const };

    try {
      const { error } = await client
        .from("operational_errors")
        .update({ resolved_at: new Date().toISOString() })
        .eq("id", data.errorId);

      return error ? { ok: false as const } : { ok: true as const };
    } catch {
      return { ok: false as const };
    }
  });
