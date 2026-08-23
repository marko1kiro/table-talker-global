import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

const errorReportSchema = z.object({
  restaurantId: z.string().uuid().nullable(),
  stage: z.string().max(60),
  reportCode: z.string().max(60),
  detail: z.string().max(1000).nullable().optional(),
  deviceId: z.string().max(200).nullable().optional(),
  crewSessionId: z.string().max(200).nullable().optional(),
});

export const reportOperationalError = createServerFn({ method: "POST" })
  .validator(z.object({ error: errorReportSchema }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { ok: false as const };

    try {
      const { error } = await client.from("operational_errors").insert({
        restaurant_id: data.error.restaurantId,
        stage: data.error.stage,
        report_code: data.error.reportCode,
        detail: data.error.detail ?? null,
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
