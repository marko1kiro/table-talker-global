import { describe, expect, it } from "vitest";
import {
  getManagerSnapshotCore,
  getManagerCrewHistoryCore,
} from "../src/lib/manager-dashboard.server";

describe("getManagerSnapshotCore", () => {
  it("normalizes the versioned snapshot payload", async () => {
    const rpc = async () => ({
      data: {
        revision: 7,
        tables: [
          {
            table_number: 1,
            status: "terisi",
            occupied_at: "2026-09-04T10:00:00Z",
            occupied_source: "kasir",
          },
          { table_number: 2, status: "kosong", occupied_at: null, occupied_source: null },
        ],
      },
      error: null,
    });
    const r = await getManagerSnapshotCore({ managerToken: "t" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.revision).toBe(7);
      expect(r.tables[0]).toMatchObject({
        tableNumber: 1,
        status: "terisi",
        occupiedAt: "2026-09-04T10:00:00Z",
      });
      expect(r.tables[1]).toMatchObject({ tableNumber: 2, status: "kosong", occupiedAt: null });
    }
  });
  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getManagerSnapshotCore({ managerToken: "t" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });
});

describe("getManagerCrewHistoryCore", () => {
  it("maps rows to camelCase with isActive", async () => {
    const rpc = async () => ({
      data: [
        {
          role: "kasir",
          display_name: "Rina",
          checked_in_at: "2026-09-04T10:00:00Z",
          is_active: true,
        },
        {
          role: "satgas",
          display_name: "Dadan",
          checked_in_at: "2026-09-03T09:00:00Z",
          is_active: false,
        },
      ],
      error: null,
    });
    const r = await getManagerCrewHistoryCore({ managerToken: "t" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.crew[0]).toEqual({
        role: "kasir",
        displayName: "Rina",
        checkedInAt: "2026-09-04T10:00:00Z",
        isActive: true,
      });
      expect(r.crew[1]).toMatchObject({ displayName: "Dadan", isActive: false });
    }
  });
  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getManagerCrewHistoryCore({ managerToken: "t" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });
  it("passes p_date as null when no date given", async () => {
    let captured: Record<string, unknown> | null = null;
    const rpc = async (_fn: string, params: Record<string, unknown>) => {
      captured = params;
      return { data: [], error: null };
    };
    await getManagerCrewHistoryCore({ managerToken: "t" }, rpc);
    expect(captured).toMatchObject({ p_manager_token: "t", p_date: null });
  });
});
