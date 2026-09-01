import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  confirmEscortIntentCore,
  createEscortIntentCore,
  getTableOccupancySnapshotCore,
  recordQrScanCore,
  setTableEmptyCleanupCore,
  setTableOccupiedKasirCore,
} from "../src/lib/table-occupancy.server";

const source = () =>
  readFileSync(new URL("../src/lib/table-occupancy.server.ts", import.meta.url), "utf8");

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const GENERIC_ERROR = "Gagal memproses permintaan meja.";

describe("setTableOccupiedKasirCore", () => {
  const input = {
    restaurantId: RESTAURANT_ID,
    tableNumber: 12,
    sessionToken: "kasir-session-token",
  };

  it("calls set_table_occupied_kasir with mapped params and returns ok on success", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("set_table_occupied_kasir");
      expect(params).toEqual({
        p_restaurant_id: RESTAURANT_ID,
        p_table_number: 12,
        p_session_token: "kasir-session-token",
      });
      return { data: null, error: null };
    };
    expect(await setTableOccupiedKasirCore(input, rpc)).toEqual({ ok: true });
  });

  it("maps INVALID_SESSION without leaking raw Postgres text", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const result = await setTableOccupiedKasirCore(input, rpc);
    expect(result).toEqual({ ok: false, code: "INVALID_SESSION", message: GENERIC_ERROR });
  });

  it("maps INVALID_TABLE_NUMBER without leaking raw Postgres text", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_TABLE_NUMBER" } });
    const result = await setTableOccupiedKasirCore(input, rpc);
    expect(result).toEqual({ ok: false, code: "INVALID_TABLE_NUMBER", message: GENERIC_ERROR });
  });

  it("maps unknown Postgres errors to UNAVAILABLE", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: 'relation "public.table_occupancy_state" does not exist' },
    });
    const result = await setTableOccupiedKasirCore(input, rpc);
    expect(result).toEqual({ ok: false, code: "UNAVAILABLE", message: GENERIC_ERROR });
    expect(JSON.stringify(result)).not.toContain("relation");
  });

  it("returns UNAVAILABLE if the RPC call throws", async () => {
    const rpc = async () => {
      throw new Error("network down");
    };
    expect(await setTableOccupiedKasirCore(input, rpc)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: GENERIC_ERROR,
    });
  });
});

describe("setTableEmptyCleanupCore", () => {
  const input = {
    restaurantId: RESTAURANT_ID,
    tableNumber: 7,
    sessionToken: "clear-up-session-token",
  };

  it("calls set_table_empty_cleanup and returns ok on success", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("set_table_empty_cleanup");
      expect(params).toEqual({
        p_restaurant_id: RESTAURANT_ID,
        p_table_number: 7,
        p_session_token: "clear-up-session-token",
      });
      return { data: null, error: null };
    };
    expect(await setTableEmptyCleanupCore(input, rpc)).toEqual({ ok: true });
  });

  it("maps INVALID_SESSION and INVALID_TABLE_NUMBER", async () => {
    const sessionRpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    expect(await setTableEmptyCleanupCore(input, sessionRpc)).toEqual({
      ok: false,
      code: "INVALID_SESSION",
      message: GENERIC_ERROR,
    });

    const tableRpc = async () => ({ data: null, error: { message: "INVALID_TABLE_NUMBER" } });
    expect(await setTableEmptyCleanupCore(input, tableRpc)).toEqual({
      ok: false,
      code: "INVALID_TABLE_NUMBER",
      message: GENERIC_ERROR,
    });
  });
});

describe("createEscortIntentCore", () => {
  const input = {
    restaurantId: RESTAURANT_ID,
    tableNumber: 5,
    sessionToken: "satgas-session-token",
  };

  it("returns the created intent id on success", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("create_escort_intent");
      expect(params).toEqual({
        p_restaurant_id: RESTAURANT_ID,
        p_table_number: 5,
        p_session_token: "satgas-session-token",
      });
      return { data: "intent-uuid-1", error: null };
    };
    expect(await createEscortIntentCore(input, rpc)).toEqual({
      ok: true,
      intentId: "intent-uuid-1",
    });
  });

  it("returns UNAVAILABLE when the RPC succeeds but returns no intent id", async () => {
    const rpc = async () => ({ data: null, error: null });
    expect(await createEscortIntentCore(input, rpc)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: GENERIC_ERROR,
    });
  });

  it("maps INVALID_SESSION and INVALID_TABLE_NUMBER", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_TABLE_NUMBER" } });
    expect(await createEscortIntentCore(input, rpc)).toEqual({
      ok: false,
      code: "INVALID_TABLE_NUMBER",
      message: GENERIC_ERROR,
    });
  });

  // H-04 remediation (Fase 2, 2026-09-02): a different Satgas session
  // already holds an active intent for this table -- a real, expected
  // outcome, not a bug, and must not fall through to UNAVAILABLE.
  it("maps ALREADY_ESCORTED without leaking raw Postgres text", async () => {
    const rpc = async () => ({ data: null, error: { message: "ALREADY_ESCORTED" } });
    expect(await createEscortIntentCore(input, rpc)).toEqual({
      ok: false,
      code: "ALREADY_ESCORTED",
      message: GENERIC_ERROR,
    });
  });
});

describe("confirmEscortIntentCore", () => {
  const input = { intentId: "intent-uuid-1", sessionToken: "satgas-session-token" };

  it("calls confirm_escort_intent and returns ok on success", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("confirm_escort_intent");
      expect(params).toEqual({
        p_intent_id: "intent-uuid-1",
        p_session_token: "satgas-session-token",
      });
      return { data: null, error: null };
    };
    expect(await confirmEscortIntentCore(input, rpc)).toEqual({ ok: true });
  });

  it("maps INTENT_NOT_FOUND and ALREADY_OCCUPIED without leaking raw text", async () => {
    const notFoundRpc = async () => ({ data: null, error: { message: "INTENT_NOT_FOUND" } });
    expect(await confirmEscortIntentCore(input, notFoundRpc)).toEqual({
      ok: false,
      code: "INTENT_NOT_FOUND",
      message: GENERIC_ERROR,
    });

    const occupiedRpc = async () => ({ data: null, error: { message: "ALREADY_OCCUPIED" } });
    expect(await confirmEscortIntentCore(input, occupiedRpc)).toEqual({
      ok: false,
      code: "ALREADY_OCCUPIED",
      message: GENERIC_ERROR,
    });
  });
});

describe("getTableOccupancySnapshotCore", () => {
  const input = { restaurantId: RESTAURANT_ID, sessionToken: "role-session-token" };

  it("normalizes the revision and all rows returned by the versioned RPC", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("get_table_occupancy_snapshot_versioned");
      expect(params).toEqual({
        p_restaurant_id: RESTAURANT_ID,
        p_session_token: "role-session-token",
      });
      return {
        data: {
          revision: 7,
          tables: [
            { table_number: 1, status: "kosong", occupied_at: null, occupied_source: null },
            {
              table_number: 2,
              status: "terisi",
              occupied_at: "2026-08-30T09:00:00.000Z",
              occupied_source: "kasir",
            },
          ],
        },
        error: null,
      };
    };
    const result = await getTableOccupancySnapshotCore(input, rpc);
    expect(result).toEqual({
      ok: true,
      revision: 7,
      tables: [
        {
          tableNumber: 1,
          status: "kosong",
          occupiedAt: null,
          occupiedSource: null,
          escortIntentId: null,
          escortIntentExpiresAt: null,
          escortIntentMine: false,
        },
        {
          tableNumber: 2,
          status: "terisi",
          occupiedAt: "2026-08-30T09:00:00.000Z",
          occupiedSource: "kasir",
          escortIntentId: null,
          escortIntentExpiresAt: null,
          escortIntentMine: false,
        },
      ],
    });
  });

  it("falls back to the legacy snapshot during a database-first rollout gap", async () => {
    const calls: string[] = [];
    const rpc = async (fn: string) => {
      calls.push(fn);
      if (fn === "get_table_occupancy_snapshot_versioned") {
        return {
          data: null,
          error: {
            message:
              "Could not find the function public.get_table_occupancy_snapshot_versioned in the schema cache",
          },
        };
      }
      return {
        data: [{ table_number: 1, status: "kosong", occupied_at: null, occupied_source: null }],
        error: null,
      };
    };

    expect(await getTableOccupancySnapshotCore(input, rpc)).toEqual({
      ok: true,
      revision: 0,
      tables: [
        {
          tableNumber: 1,
          status: "kosong",
          occupiedAt: null,
          occupiedSource: null,
          escortIntentId: null,
          escortIntentExpiresAt: null,
          escortIntentMine: false,
        },
      ],
    });
    expect(calls).toEqual([
      "get_table_occupancy_snapshot_versioned",
      "get_table_occupancy_snapshot",
    ]);
  });

  // H-04 remediation (Fase 2, 2026-09-02): get_table_occupancy_snapshot
  // (supabase/migrations/20260902040000_escort_intent_duplicate_guard.sql)
  // now surfaces an active escort intent on a KOSONG row, including
  // whether it belongs to the calling session.
  it("normalizes a versioned kosong row carrying an active escort intent", async () => {
    const rpc = async () => ({
      data: {
        revision: 8,
        tables: [
          {
            table_number: 5,
            status: "kosong",
            occupied_at: null,
            occupied_source: null,
            escort_intent_id: "intent-uuid-9",
            escort_intent_expires_at: "2026-09-02T01:50:00.000Z",
            escort_intent_mine: true,
          },
        ],
      },
      error: null,
    });
    const result = await getTableOccupancySnapshotCore(input, rpc);
    expect(result).toEqual({
      ok: true,
      revision: 8,
      tables: [
        {
          tableNumber: 5,
          status: "kosong",
          occupiedAt: null,
          occupiedSource: null,
          escortIntentId: "intent-uuid-9",
          escortIntentExpiresAt: "2026-09-02T01:50:00.000Z",
          escortIntentMine: true,
        },
      ],
    });
  });

  it("maps INVALID_SESSION without leaking raw Postgres text", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    expect(await getTableOccupancySnapshotCore(input, rpc)).toEqual({
      ok: false,
      code: "INVALID_SESSION",
      message: GENERIC_ERROR,
    });
  });

  it.each([
    null,
    { revision: -1, tables: [] },
    { revision: 1.5, tables: [] },
    { revision: 1, tables: null },
  ])("returns UNAVAILABLE for a malformed versioned response: %j", async (data) => {
    const rpc = async () => ({ data, error: null });
    expect(await getTableOccupancySnapshotCore(input, rpc)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: GENERIC_ERROR,
    });
  });
});

describe("recordQrScanCore", () => {
  const input = { restaurantId: RESTAURANT_ID, tableNumber: 42 };

  it("calls record_qr_scan and returns ok on success", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("record_qr_scan");
      expect(params).toEqual({ p_restaurant_id: RESTAURANT_ID, p_table_number: 42 });
      return { data: null, error: null };
    };
    expect(await recordQrScanCore(input, rpc)).toEqual({ ok: true });
  });

  it("maps INVALID_TABLE_NUMBER and RESTAURANT_NOT_FOUND", async () => {
    const tableRpc = async () => ({ data: null, error: { message: "INVALID_TABLE_NUMBER" } });
    expect(await recordQrScanCore(input, tableRpc)).toEqual({
      ok: false,
      code: "INVALID_TABLE_NUMBER",
      message: GENERIC_ERROR,
    });

    const restaurantRpc = async () => ({ data: null, error: { message: "RESTAURANT_NOT_FOUND" } });
    expect(await recordQrScanCore(input, restaurantRpc)).toEqual({
      ok: false,
      code: "RESTAURANT_NOT_FOUND",
      message: GENERIC_ERROR,
    });
  });
});

describe("table-occupancy.server.ts source contract", () => {
  it("uses getAnonAuthedSupabaseClient (not the service client) for the five authenticated-only RPCs", () => {
    const text = source();
    for (const fn of [
      "setTableOccupiedKasir",
      "setTableEmptyCleanup",
      "createEscortIntent",
      "confirmEscortIntent",
      "getTableOccupancySnapshot",
    ]) {
      const start = text.indexOf(`export const ${fn} = createServerFn`);
      expect(start, `${fn} should be exported as a createServerFn`).toBeGreaterThan(-1);
      const block = text.slice(start, start + 400);
      expect(block).toContain("getAnonAuthedSupabaseClient(data.accessToken)");
    }
  });

  it("requires an accessToken parameter for every authenticated-only RPC's input schema", () => {
    const text = source();
    expect(text).toContain("tableSessionActionSchema");
    expect(text).toContain("confirmEscortIntentInputSchema");
    expect(text).toContain("tableOccupancySnapshotInputSchema");
    const schemaBlocks = text.match(/accessToken: z\.string\(\)\.min\(1\)/g) ?? [];
    expect(schemaBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it("only recordQrScan uses the plain service-role client and has no accessToken parameter", () => {
    const text = source();
    const start = text.indexOf("export const recordQrScan = createServerFn");
    const block = text.slice(start, start + 400);
    expect(block).toContain("getServiceClient()");
    expect(text).not.toMatch(/recordQrScanInputSchema[\s\S]{0,120}accessToken/);
  });
});
