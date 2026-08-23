import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";

const eventSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid().nullable(),
  audioId: z.string().max(120),
  label: z.string().max(200),
  eventTimestamp: z.string(),
  crewName: z.string().max(100),
  crewSessionId: z.string().max(200),
  deviceId: z.string().max(200),
  status: z.enum(["played", "failed"]),
  errorDetail: z.string().max(1000).nullable().optional(),
});

export const ingestPlaybackEvents = createServerFn({ method: "POST" })
  .validator(z.object({ events: z.array(eventSchema).max(50) }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { ok: false as const, ids: [] as string[] };

    try {
      const rows = data.events.map((e) => ({
        id: e.id,
        restaurant_id: e.restaurantId,
        audio_id: e.audioId,
        label: e.label,
        event_timestamp: e.eventTimestamp,
        crew_name: e.crewName,
        crew_session_id: e.crewSessionId,
        device_id: e.deviceId,
        status: e.status,
        error_detail: e.errorDetail ?? null,
      }));

      const { error } = await client
        .from("playback_events")
        .upsert(rows, { onConflict: "id", ignoreDuplicates: true });

      if (error) return { ok: false as const, ids: [] as string[] };

      return { ok: true as const, ids: data.events.map((e) => e.id) };
    } catch {
      return { ok: false as const, ids: [] as string[] };
    }
  });

export const cleanupOldPlaybackEvents = createServerFn({ method: "POST" })
  .validator(z.object({ olderThanDays: z.number().int().min(1).default(30) }))
  .handler(async ({ data }) => {
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
