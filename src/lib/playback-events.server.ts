import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { verifyTenantSession } from "./tenant-session.server";

const eventSchema = z.object({
  id: z.string().uuid(),
  audioId: z.string().max(120),
  label: z.string().max(200),
  eventTimestamp: z.string(),
  crewSessionId: z.string().max(200),
  deviceId: z.string().max(200),
  status: z.enum(["played", "failed"]),
  errorDetail: z.string().max(1000).nullable().optional(),
});

export const playbackEventBatchSchema = z.object({
  tenantToken: z.string(),
  events: z.array(eventSchema).min(1).max(50),
});

export async function ingestPlaybackEventBatch(data: z.infer<typeof playbackEventBatchSchema>) {
  const tenant = verifyTenantSession(data.tenantToken);
  if (!tenant) return { ok: false as const, ids: [] as string[] };

  const client = getServiceClient();
  if (!client) return { ok: false as const, ids: [] as string[] };

  try {
    const sessionIds = [...new Set(data.events.map((event) => event.crewSessionId))];
    const { data: sessions, error: sessionError } = await client
      .from("crew_sessions")
      .select("id, display_name")
      .eq("restaurant_id", tenant.restaurantId)
      .in("id", sessionIds);
    if (sessionError || !sessions || sessions.length !== sessionIds.length)
      return { ok: false as const, ids: [] as string[] };

    const sessionsById = new Map(sessions.map((session) => [session.id, session]));
    const rows = data.events.map((event) => {
      const session = sessionsById.get(event.crewSessionId)!;
      return {
        id: event.id,
        restaurant_id: tenant.restaurantId,
        audio_id: event.audioId,
        label: event.label,
        event_timestamp: event.eventTimestamp,
        crew_name: session.display_name,
        crew_session_id: session.id,
        device_id: event.deviceId,
        status: event.status,
        error_detail: event.errorDetail ?? null,
      };
    });

    const { error } = await client
      .from("playback_events")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    return error
      ? { ok: false as const, ids: [] as string[] }
      : {
          ok: true as const,
          ids: data.events.map((event) => event.id),
        };
  } catch {
    return { ok: false as const, ids: [] as string[] };
  }
}

export const ingestPlaybackEvents = createServerFn({ method: "POST" })
  .validator(playbackEventBatchSchema)
  .handler(async ({ data }) => ingestPlaybackEventBatch(data));

export const cleanupOldPlaybackEvents = createServerFn({ method: "POST" })
  .validator(z.object({ olderThanDays: z.number().int().min(1).default(30) }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return { deleted: 0 };

    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - data.olderThanDays);

      const { count, error } = await client
        .from("playback_events")
        .delete({ count: "exact" })
        .lt("created_at", cutoff.toISOString());

      return { deleted: error ? 0 : (count ?? 0) };
    } catch {
      return { deleted: 0 };
    }
  });
