import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";
import { CREW_ROLES, getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";

// Task 6 Step 9 (revised design -- see docs/superpowers/plans/
// 2026-08-29-table-occupancy-tracking.md, Task 6 Step 9 note): every RPC in
// this file except recordQrScan is `revoke ... from service_role` / `grant
// execute ... to authenticated` in
// supabase/migrations/20260829020000_table_occupancy_rpcs.sql. A
// service-role client can never call them successfully in production, so
// each of those wrappers takes the caller's Supabase Auth access token
// (anonymous auth is sufficient -- Task 8 must obtain one per device for
// all 4 roles, not just SS) and forwards it as a per-request
// `Authorization: Bearer` header via getAnonAuthedSupabaseClient. Only
// recordQrScan -- genuinely `grant ... to service_role` -- uses the plain
// service-role client from remote-audio.server.ts.

const GENERIC_ERROR = "Gagal memproses permintaan meja.";

function unavailable() {
  return { ok: false as const, code: "UNAVAILABLE" as const, message: GENERIC_ERROR };
}

function mapError<Code extends string>(
  message: string,
  knownCodes: readonly Code[],
): { ok: false; code: Code | "UNAVAILABLE"; message: string } {
  const code = (knownCodes as readonly string[]).includes(message)
    ? (message as Code)
    : ("UNAVAILABLE" as const);
  return { ok: false, code, message: GENERIC_ERROR };
}

// ---------------------------------------------------------------------------
// set_table_occupied_kasir
// ---------------------------------------------------------------------------

export const tableSessionActionSchema = z.object({
  restaurantId: z.string().uuid(),
  tableNumber: z.number().int().min(1).max(100),
  sessionToken: z.string().min(1),
  accessToken: z.string().min(1),
});
type TableSessionActionRpcInput = Omit<z.infer<typeof tableSessionActionSchema>, "accessToken">;

const SESSION_ACTION_ERRORS = ["INVALID_SESSION", "INVALID_TABLE_NUMBER"] as const;
export type SessionActionResult =
  | { ok: true }
  | {
      ok: false;
      code: (typeof SESSION_ACTION_ERRORS)[number] | "UNAVAILABLE";
      message: string;
    };

export async function setTableOccupiedKasirCore(
  data: TableSessionActionRpcInput,
  rpc: RpcCaller,
): Promise<SessionActionResult> {
  try {
    const { error } = await rpc("set_table_occupied_kasir", {
      p_restaurant_id: data.restaurantId,
      p_table_number: data.tableNumber,
      p_session_token: data.sessionToken,
    });
    if (error) return mapError(error.message, SESSION_ACTION_ERRORS);
    return { ok: true };
  } catch {
    return unavailable();
  }
}

export const setTableOccupiedKasir = createServerFn({ method: "POST" })
  .validator(tableSessionActionSchema)
  .handler(async ({ data }): Promise<SessionActionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return unavailable();
    const { accessToken: _accessToken, ...rpcData } = data;
    return setTableOccupiedKasirCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });

// ---------------------------------------------------------------------------
// set_table_empty_cleanup
// ---------------------------------------------------------------------------

export async function setTableEmptyCleanupCore(
  data: TableSessionActionRpcInput,
  rpc: RpcCaller,
): Promise<SessionActionResult> {
  try {
    const { error } = await rpc("set_table_empty_cleanup", {
      p_restaurant_id: data.restaurantId,
      p_table_number: data.tableNumber,
      p_session_token: data.sessionToken,
    });
    if (error) return mapError(error.message, SESSION_ACTION_ERRORS);
    return { ok: true };
  } catch {
    return unavailable();
  }
}

export const setTableEmptyCleanup = createServerFn({ method: "POST" })
  .validator(tableSessionActionSchema)
  .handler(async ({ data }): Promise<SessionActionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return unavailable();
    const { accessToken: _accessToken, ...rpcData } = data;
    return setTableEmptyCleanupCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });

// ---------------------------------------------------------------------------
// create_escort_intent
// ---------------------------------------------------------------------------

const CREATE_ESCORT_INTENT_ERRORS = ["INVALID_SESSION", "INVALID_TABLE_NUMBER"] as const;
export type CreateEscortIntentResult =
  | { ok: true; intentId: string }
  | {
      ok: false;
      code: (typeof CREATE_ESCORT_INTENT_ERRORS)[number] | "UNAVAILABLE";
      message: string;
    };

export async function createEscortIntentCore(
  data: TableSessionActionRpcInput,
  rpc: RpcCaller,
): Promise<CreateEscortIntentResult> {
  try {
    const { data: intentId, error } = await rpc("create_escort_intent", {
      p_restaurant_id: data.restaurantId,
      p_table_number: data.tableNumber,
      p_session_token: data.sessionToken,
    });
    if (error) return mapError(error.message, CREATE_ESCORT_INTENT_ERRORS);
    if (typeof intentId !== "string") return unavailable();
    return { ok: true, intentId };
  } catch {
    return unavailable();
  }
}

export const createEscortIntent = createServerFn({ method: "POST" })
  .validator(tableSessionActionSchema)
  .handler(async ({ data }): Promise<CreateEscortIntentResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return unavailable();
    const { accessToken: _accessToken, ...rpcData } = data;
    return createEscortIntentCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });

// ---------------------------------------------------------------------------
// confirm_escort_intent
// ---------------------------------------------------------------------------

export const confirmEscortIntentInputSchema = z.object({
  intentId: z.string().uuid(),
  sessionToken: z.string().min(1),
  accessToken: z.string().min(1),
});
type ConfirmEscortIntentRpcInput = Omit<
  z.infer<typeof confirmEscortIntentInputSchema>,
  "accessToken"
>;

const CONFIRM_ESCORT_INTENT_ERRORS = [
  "INVALID_SESSION",
  "INTENT_NOT_FOUND",
  "ALREADY_OCCUPIED",
] as const;
export type ConfirmEscortIntentResult =
  | { ok: true }
  | {
      ok: false;
      code: (typeof CONFIRM_ESCORT_INTENT_ERRORS)[number] | "UNAVAILABLE";
      message: string;
    };

export async function confirmEscortIntentCore(
  data: ConfirmEscortIntentRpcInput,
  rpc: RpcCaller,
): Promise<ConfirmEscortIntentResult> {
  try {
    const { error } = await rpc("confirm_escort_intent", {
      p_intent_id: data.intentId,
      p_session_token: data.sessionToken,
    });
    if (error) return mapError(error.message, CONFIRM_ESCORT_INTENT_ERRORS);
    return { ok: true };
  } catch {
    return unavailable();
  }
}

export const confirmEscortIntent = createServerFn({ method: "POST" })
  .validator(confirmEscortIntentInputSchema)
  .handler(async ({ data }): Promise<ConfirmEscortIntentResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return unavailable();
    const { accessToken: _accessToken, ...rpcData } = data;
    return confirmEscortIntentCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });

// ---------------------------------------------------------------------------
// get_table_occupancy_snapshot
// ---------------------------------------------------------------------------

export const tableOccupancySnapshotInputSchema = z.object({
  restaurantId: z.string().uuid(),
  sessionToken: z.string().min(1),
  accessToken: z.string().min(1),
});
type TableOccupancySnapshotRpcInput = Omit<
  z.infer<typeof tableOccupancySnapshotInputSchema>,
  "accessToken"
>;

export type TableOccupancyRow = {
  tableNumber: number;
  status: "kosong" | "terisi";
  occupiedAt: string | null;
  occupiedSource: string | null;
};

export type TableOccupancySnapshotResult =
  | { ok: true; tables: TableOccupancyRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export async function getTableOccupancySnapshotCore(
  data: TableOccupancySnapshotRpcInput,
  rpc: RpcCaller,
): Promise<TableOccupancySnapshotResult> {
  try {
    const { data: rows, error } = await rpc("get_table_occupancy_snapshot", {
      p_restaurant_id: data.restaurantId,
      p_session_token: data.sessionToken,
    });
    if (error) return mapError(error.message, ["INVALID_SESSION"] as const);
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR };
    const tables: TableOccupancyRow[] = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        tableNumber: Number(r.table_number),
        status: r.status as "kosong" | "terisi",
        occupiedAt: (r.occupied_at as string | null) ?? null,
        occupiedSource: (r.occupied_source as string | null) ?? null,
      };
    });
    return { ok: true, tables };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR };
  }
}

export const getTableOccupancySnapshot = createServerFn({ method: "GET" })
  .validator(tableOccupancySnapshotInputSchema)
  .handler(async ({ data }): Promise<TableOccupancySnapshotResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR };
    const { accessToken: _accessToken, ...rpcData } = data;
    return getTableOccupancySnapshotCore(rpcData, async (fn, params) => client.rpc(fn, params));
  });

// ---------------------------------------------------------------------------
// record_qr_scan -- the sole RPC actually granted to service_role; called
// server-to-server from the Task 7 QR Interceptor, never from a browser,
// and therefore never takes an accessToken.
// ---------------------------------------------------------------------------

export const recordQrScanInputSchema = z.object({
  restaurantId: z.string().uuid(),
  tableNumber: z.number().int().min(1).max(100),
});
type RecordQrScanRpcInput = z.infer<typeof recordQrScanInputSchema>;

const RECORD_QR_SCAN_ERRORS = ["INVALID_TABLE_NUMBER", "RESTAURANT_NOT_FOUND"] as const;
export type RecordQrScanResult =
  | { ok: true }
  | {
      ok: false;
      code: (typeof RECORD_QR_SCAN_ERRORS)[number] | "UNAVAILABLE";
      message: string;
    };

export async function recordQrScanCore(
  data: RecordQrScanRpcInput,
  rpc: RpcCaller,
): Promise<RecordQrScanResult> {
  try {
    const { error } = await rpc("record_qr_scan", {
      p_restaurant_id: data.restaurantId,
      p_table_number: data.tableNumber,
    });
    if (error) return mapError(error.message, RECORD_QR_SCAN_ERRORS);
    return { ok: true };
  } catch {
    return unavailable();
  }
}

export const recordQrScan = createServerFn({ method: "POST" })
  .validator(recordQrScanInputSchema)
  .handler(async ({ data }): Promise<RecordQrScanResult> => {
    const client = getServiceClient();
    if (!client) return unavailable();
    return recordQrScanCore(data, async (fn, params) => client.rpc(fn, params));
  });

// Re-exported so callers/tests only need to import from this one file for
// the full Task 6 RPC surface, even though claim_role_session itself lives
// in role-session.server.ts (kept separate per the plan's file split).
export { CREW_ROLES };
