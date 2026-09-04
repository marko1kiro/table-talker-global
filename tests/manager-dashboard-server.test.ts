import { describe, expect, it } from "vitest";
import {
  getManagerSnapshotCore,
  getManagerActiveCrewCore,
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

describe("getManagerActiveCrewCore", () => {
  it("maps rows to camelCase", async () => {
    const rpc = async () => ({
      data: [{ role: "kasir", display_name: "Rina", checked_in_at: "2026-09-04T10:00:00Z" }],
      error: null,
    });
    const r = await getManagerActiveCrewCore({ managerToken: "t" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.crew[0]).toEqual({
        role: "kasir",
        displayName: "Rina",
        checkedInAt: "2026-09-04T10:00:00Z",
      });
  });
  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getManagerActiveCrewCore({ managerToken: "t" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });
});
