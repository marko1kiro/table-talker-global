import { describe, expect, it } from "vitest";
import { getManagerDailyStatsCore } from "../src/lib/manager-stats.server";

describe("getManagerDailyStatsCore", () => {
  it("normalizes RPC result", async () => {
    const rpc = async () => ({
      data: {
        total_served: 12,
        avg_duration_minutes: 23.5,
        peak_hour: 14,
        per_table: [
          {
            table_number: 1,
            times_occupied: 3,
            total_minutes: 70,
            avg_minutes: 23.3,
          },
          {
            table_number: 2,
            times_occupied: 0,
            total_minutes: 0,
            avg_minutes: null,
          },
        ],
      },
      error: null,
    });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalServed).toBe(12);
      expect(r.avgDurationMinutes).toBe(23.5);
      expect(r.peakHour).toBe(14);
      expect(r.perTable[0]).toEqual({
        tableNumber: 1,
        timesOccupied: 3,
        totalMinutes: 70,
        avgMinutes: 23.3,
      });
      expect(r.perTable[1]).toMatchObject({
        tableNumber: 2,
        timesOccupied: 0,
        avgMinutes: null,
      });
    }
  });

  it("maps INVALID_SESSION", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "INVALID_SESSION" },
    });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("maps generic RPC error", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "connection timeout" },
    });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("handles null per_table gracefully", async () => {
    const rpc = async () => ({
      data: {
        total_served: 0,
        avg_duration_minutes: null,
        peak_hour: null,
        per_table: null,
      },
      error: null,
    });
    const r = await getManagerDailyStatsCore({ managerToken: "t", date: "2026-09-07" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.totalServed).toBe(0);
      expect(r.perTable).toEqual([]);
    }
  });
});
