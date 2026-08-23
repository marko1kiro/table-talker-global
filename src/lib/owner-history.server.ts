import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { normalizeHistoryRange, normalizeHistorySearch } from "./owner-history-domain";
import { getServiceClient } from "./remote-audio.server";

const PAGE_SIZE = 50;

const historySchema = z.object({
  restaurantId: z.string().uuid().optional(),
  type: z.enum(["playback", "sync"]).default("playback"),
  status: z.string().trim().max(60).optional(),
  text: z.string().max(101).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.number().int().min(1).default(1),
});

export const listOwnerHistory = createServerFn({ method: "GET" })
  .validator(historySchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const range = normalizeHistoryRange(data);
    if (!range.ok) return { ok: false as const, code: range.code, message: "Rentang tanggal tidak valid." };
    const search = normalizeHistorySearch(data.text);
    if (!search.ok) return { ok: false as const, code: search.code, message: "Pencarian terlalu panjang." };
    const client = getServiceClient();
    if (!client) return { ok: false as const, code: "UNAVAILABLE" as const, message: "Riwayat tidak tersedia." };
    const offset = (data.page - 1) * PAGE_SIZE;

    try {
      if (data.type === "sync") {
        let query = client
          .from("operational_errors")
          .select("id,restaurant_id,stage,report_code,detail,occurred_at,resolved_at", { count: "exact" })
          .eq("stage", "sync_cache")
          .gte("occurred_at", range.from)
          .lte("occurred_at", range.to)
          .order("occurred_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (data.restaurantId) query = query.eq("restaurant_id", data.restaurantId);
        if (data.status === "resolved") query = query.not("resolved_at", "is", null);
        if (data.status === "unresolved") query = query.is("resolved_at", null);
        if (search.text) query = query.or(`report_code.ilike.%${search.text}%,detail.ilike.%${search.text}%`);
        const { data: rows, count, error } = await query;
        if (error) return { ok: false as const, code: "UNAVAILABLE" as const, message: "Riwayat sinkronisasi tidak tersedia." };
        return { ok: true as const, type: data.type, rows: rows ?? [], page: data.page, total: count ?? 0, nextPage: offset + PAGE_SIZE < (count ?? 0) ? data.page + 1 : null };
      }

      let query = client
        .from("playback_events")
        .select("id,restaurant_id,audio_id,label,event_timestamp,crew_name,device_id,status,error_detail", { count: "exact" })
        .gte("event_timestamp", range.from)
        .lte("event_timestamp", range.to)
        .order("event_timestamp", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (data.restaurantId) query = query.eq("restaurant_id", data.restaurantId);
      if (data.status) query = query.eq("status", data.status);
      if (search.text) query = query.or(`audio_id.ilike.%${search.text}%,label.ilike.%${search.text}%,crew_name.ilike.%${search.text}%`);
      const { data: rows, count, error } = await query;
      if (error) return { ok: false as const, code: "UNAVAILABLE" as const, message: "Riwayat playback tidak tersedia." };
      return { ok: true as const, type: data.type, rows: rows ?? [], page: data.page, total: count ?? 0, nextPage: offset + PAGE_SIZE < (count ?? 0) ? data.page + 1 : null };
    } catch {
      return { ok: false as const, code: "UNAVAILABLE" as const, message: "Riwayat tidak tersedia." };
    }
  });
