import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";
import type { TableOccupancyRow } from "./table-occupancy.server";

const GENERIC = "Gagal memuat data manager.";

export const managerSnapshotInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
});

export type ManagerSnapshotResult =
  | { ok: true; revision: number; tables: TableOccupancyRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

function normalizeManagerRows(rows: unknown[]): TableOccupancyRow[] {
  return rows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      tableNumber: Number(r.table_number),
      status: r.status === "terisi" ? "terisi" : "kosong",
      occupiedAt: typeof r.occupied_at === "string" ? r.occupied_at : null,
      occupiedSource: typeof r.occupied_source === "string" ? r.occupied_source : null,
      escortIntentId: null,
      escortIntentExpiresAt: null,
      escortIntentMine: false,
    };
  });
}

export async function getManagerSnapshotCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<ManagerSnapshotResult> {
  try {
    const { data: snapshot, error } = await rpc("get_manager_snapshot", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    const raw = snapshot as { revision?: unknown; tables?: unknown } | null;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.tables)) {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    }
    const revision = typeof raw.revision === "number" ? raw.revision : 0;
    return { ok: true, revision, tables: normalizeManagerRows(raw.tables) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerSnapshot = createServerFn({ method: "GET" })
  .validator(managerSnapshotInputSchema)
  .handler(async ({ data }): Promise<ManagerSnapshotResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerSnapshotCore({ managerToken: data.managerToken }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });

export const managerActiveCrewInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
});

export type ActiveCrewRow = { role: string; displayName: string; checkedInAt: string };
export type ManagerActiveCrewResult =
  | { ok: true; crew: ActiveCrewRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export async function getManagerActiveCrewCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<ManagerActiveCrewResult> {
  try {
    const { data: rows, error } = await rpc("get_manager_active_crew", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return {
        ok: false,
        code: error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE",
        message: GENERIC,
      };
    }
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    const crew = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        role: String(r.role),
        displayName: String(r.display_name),
        checkedInAt: String(r.checked_in_at),
      };
    });
    return { ok: true, crew };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export const getManagerActiveCrew = createServerFn({ method: "GET" })
  .validator(managerActiveCrewInputSchema)
  .handler(async ({ data }): Promise<ManagerActiveCrewResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getManagerActiveCrewCore({ managerToken: data.managerToken }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });
