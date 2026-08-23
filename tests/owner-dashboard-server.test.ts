import { describe, expect, it } from "vitest";
import { getOwnerDashboardSnapshotCore } from "../src/lib/owner-dashboard.server";

describe("owner dashboard snapshot core", () => {
  it("keeps healthy checks when R2 fails", async () => {
    const result = await getOwnerDashboardSnapshotCore({
      since: "2026-08-24T11:00:00.000Z",
      now: Date.parse("2026-08-24T12:00:00.000Z"),
      rpc: async () => ({
        total_restaurants: 1,
        active_restaurants: 1,
        active_crew_devices: 1,
        plays_today: 1,
        sync_failures: 0,
        unresolved_errors: 0,
      }),
      r2Probe: async () => ({ status: "unavailable", message: "R2 tidak merespons." }),
      apiProbe: async () => ({ status: "healthy" }),
    });

    expect(result.health).toEqual({
      database: { status: "healthy" },
      r2: { status: "unavailable", message: "R2 tidak merespons." },
      api: { status: "healthy" },
    });
  });

  it("preserves timeout status and passes clamped RPC period", async () => {
    let receivedSince = "";
    const result = await getOwnerDashboardSnapshotCore({
      since: "2026-07-01T00:00:00.000Z",
      now: Date.parse("2026-08-24T12:00:00.000Z"),
      rpc: async (since) => {
        receivedSince = since;
        return {
          total_restaurants: 1,
          active_restaurants: 1,
          active_crew_devices: 1,
          plays_today: 1,
          sync_failures: 0,
          unresolved_errors: 0,
        };
      },
      r2Probe: async () => ({ status: "timeout", message: "Waktu habis." }),
      apiProbe: async () => ({ status: "healthy" }),
    });

    expect(receivedSince).toBe("2026-07-25T12:00:00.000Z");
    expect(result.health.r2).toEqual({ status: "timeout", message: "Waktu habis." });
  });
});
