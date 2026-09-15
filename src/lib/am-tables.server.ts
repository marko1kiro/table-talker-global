import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAreaManager } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";

const GENERIC = "Gagal memuat data meja.";

type ScopeCode = "NOT_AUTHORIZED" | "UNAVAILABLE";

function toCode(message: string): ScopeCode {
  return message === "NOT_AUTHORIZED" ? "NOT_AUTHORIZED" : "UNAVAILABLE";
}

function serviceRpc(): RpcCaller | null {
  const client = getServiceClient();
  return client ? async (fn, params) => client.rpc(fn, params) : null;
}

async function currentAmId(): Promise<string | null> {
  const session = await requireAreaManager();
  const accountId = session.data.areaManagerAccountId;
  if (!accountId) return null;
  const client = getServiceClient();
  if (!client) return null;
  const { data } = await client
    .from("area_manager_accounts")
    .select("id")
    .eq("id", accountId)
    .eq("status", "aktif")
    .single();
  const row = data as { id: string } | null;
  return row ? row.id : null;
}

export type AmTableRow = {
  tableNumber: number;
  status: "kosong" | "terisi";
  occupiedAt: string | null;
  occupiedSource: string | null;
  updatedAt: string | null;
};

export type AmTableSnapshotResult =
  | { ok: true; tables: AmTableRow[] }
  | { ok: false; code: ScopeCode };

export async function amTableSnapshotCore(
  data: { amId: string; restaurantId: string },
  rpc: RpcCaller,
): Promise<AmTableSnapshotResult> {
  try {
    const { data: rows, error } = await rpc("am_table_snapshot", {
      p_am_id: data.amId,
      p_restaurant_id: data.restaurantId,
    });
    if (error) return { ok: false, code: toCode(error.message) };
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE" };
    return {
      ok: true,
      tables: (rows as Record<string, unknown>[]).map((r) => ({
        tableNumber: Number(r.table_number),
        status: r.status === "terisi" ? "terisi" : "kosong",
        occupiedAt: typeof r.occupied_at === "string" ? r.occupied_at : null,
        occupiedSource: typeof r.occupied_source === "string" ? r.occupied_source : null,
        updatedAt: typeof r.updated_at === "string" ? r.updated_at : null,
      })),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export type AmPerTableStat = {
  tableNumber: number;
  timesOccupied: number;
  totalMinutes: number;
  avgMinutes: number | null;
};

export type AmTableStatsResult =
  | {
      ok: true;
      totalServed: number;
      peakHour: number | null;
      avgMinutes: number | null;
      perTable: AmPerTableStat[];
    }
  | { ok: false; code: ScopeCode };

export async function amTableStatsCore(
  data: { amId: string; restaurantId: string; date: string },
  rpc: RpcCaller,
): Promise<AmTableStatsResult> {
  try {
    const { data: raw, error } = await rpc("am_table_stats", {
      p_am_id: data.amId,
      p_restaurant_id: data.restaurantId,
      p_date: data.date,
    });
    if (error) return { ok: false, code: toCode(error.message) };
    const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
    if (!row || typeof row !== "object") return { ok: false, code: "UNAVAILABLE" };
    const perTableRaw = Array.isArray(row.per_table) ? row.per_table : [];
    return {
      ok: true,
      totalServed: typeof row.total_served === "number" ? row.total_served : 0,
      peakHour: typeof row.peak_hour === "number" ? row.peak_hour : null,
      avgMinutes: typeof row.avg_minutes === "number" ? row.avg_minutes : null,
      perTable: (perTableRaw as Record<string, unknown>[]).map((r) => ({
        tableNumber: Number(r.table_number),
        timesOccupied: Number(r.times_occupied),
        totalMinutes: Number(r.total_minutes),
        avgMinutes: typeof r.avg_minutes === "number" ? r.avg_minutes : null,
      })),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export type AmLeaderboardRow = {
  restaurantId: string;
  displayName: string;
  guests: number;
};

export type AmLeaderboardResult =
  | { ok: true; rows: AmLeaderboardRow[] }
  | { ok: false; code: ScopeCode };

export async function amLeaderboardCore(
  data: { amId: string; from: string; to: string },
  rpc: RpcCaller,
): Promise<AmLeaderboardResult> {
  try {
    const { data: rows, error } = await rpc("am_leaderboard", {
      p_am_id: data.amId,
      p_from: data.from,
      p_to: data.to,
    });
    if (error) return { ok: false, code: toCode(error.message) };
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE" };
    return {
      ok: true,
      rows: (rows as Record<string, unknown>[]).map((r) => ({
        restaurantId: String(r.restaurant_id),
        displayName: String(r.display_name),
        guests: Number(r.guests),
      })),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export type AmBindResult = { ok: true } | { ok: false; code: ScopeCode };

export async function amBindTableRealtimeCore(
  data: { amId: string; restaurantId: string },
  rpc: RpcCaller,
): Promise<AmBindResult> {
  try {
    const { error } = await rpc("bind_am_table_realtime", {
      p_am_id: data.amId,
      p_restaurant_id: data.restaurantId,
    });
    if (error) return { ok: false, code: toCode(error.message) };
    return { ok: true };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export const amTableSnapshotInput = z.object({
  restaurantId: z.string().uuid(),
});

export const amTableSnapshot = createServerFn({ method: "GET" })
  .validator(amTableSnapshotInput)
  .handler(async ({ data }): Promise<AmTableSnapshotResult> => {
    const amId = await currentAmId();
    if (!amId) return { ok: false, code: "NOT_AUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    return amTableSnapshotCore({ amId, restaurantId: data.restaurantId }, rpc);
  });

export const amTableStatsInput = z.object({
  restaurantId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const amTableStats = createServerFn({ method: "GET" })
  .validator(amTableStatsInput)
  .handler(async ({ data }): Promise<AmTableStatsResult> => {
    const amId = await currentAmId();
    if (!amId) return { ok: false, code: "NOT_AUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    return amTableStatsCore({ amId, restaurantId: data.restaurantId, date: data.date }, rpc);
  });

export const amLeaderboardInput = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const amLeaderboard = createServerFn({ method: "GET" })
  .validator(amLeaderboardInput)
  .handler(async ({ data }): Promise<AmLeaderboardResult> => {
    const amId = await currentAmId();
    if (!amId) return { ok: false, code: "NOT_AUTHORIZED" };
    const rpc = serviceRpc();
    if (!rpc) return { ok: false, code: "UNAVAILABLE" };
    return amLeaderboardCore({ amId, from: data.from, to: data.to }, rpc);
  });

export const amBindTableRealtimeInput = z.object({
  accessToken: z.string().min(1),
  restaurantId: z.string().uuid(),
});

export const amBindTableRealtime = createServerFn({ method: "POST" })
  .validator(amBindTableRealtimeInput)
  .handler(async ({ data }): Promise<AmBindResult> => {
    const amId = await currentAmId();
    if (!amId) return { ok: false, code: "NOT_AUTHORIZED" };
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE" };
    return amBindTableRealtimeCore({ amId, restaurantId: data.restaurantId }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });

export { GENERIC };
