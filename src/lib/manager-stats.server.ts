import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";

const GENERIC = "Gagal memuat statistik.";

export const managerDailyStatsInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type PerTableStat = {
  tableNumber: number;
  timesOccupied: number;
  totalMinutes: number;
  avgMinutes: number | null;
};

export type DailyStatsResult =
  | {
      ok: true;
      totalServed: number;
      avgDurationMinutes: number | null;
      peakHour: number | null;
      perTable: PerTableStat[];
    }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export async function getManagerDailyStatsCore(
  data: { managerToken: string; date: string },
  rpc: RpcCaller,
): Promise<DailyStatsResult> {
  try {
    const { data: raw, error } = await rpc("get_manager_daily_stats", {
      p_manager_token: data.managerToken,
      p_date: data.date,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    const obj = raw as Record<string, unknown> | null;
    if (!obj || typeof obj !== "object") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    }
    const perTableRaw = Array.isArray(obj.per_table) ? obj.per_table : [];
    return {
      ok: true,
      totalServed: typeof obj.total_served === "number" ? obj.total_served : 0,
      avgDurationMinutes:
        typeof obj.avg_duration_minutes === "number" ? obj.avg_duration_minutes : null,
      peakHour: typeof obj.peak_hour === "number" ? obj.peak_hour : null,
      perTable: perTableRaw.map((r: Record<string, unknown>) => ({
        tableNumber: Number(r.table_number),
        timesOccupied: Number(r.times_occupied),
        totalMinutes: Number(r.total_minutes),
        avgMinutes: typeof r.avg_minutes === "number" ? r.avg_minutes : null,
      })),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerDailyStats = createServerFn({ method: "GET" })
  .validator(managerDailyStatsInputSchema)
  .handler(async ({ data }): Promise<DailyStatsResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerDailyStatsCore(
      { managerToken: data.managerToken, date: data.date },
      async (fn, params) => client.rpc(fn, params),
    );
  });
