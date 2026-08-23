import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SYNC_FAILURE_STAGES,
  clampDashboardSince,
  mergeDashboardHealth,
  withTimeout,
} from "../src/lib/owner-dashboard-domain";

describe("owner dashboard domain", () => {
  it("keeps sync failure stages aligned with operational error allowlist", () => {
    expect(DASHBOARD_SYNC_FAILURE_STAGES).toEqual(["sync_cache"]);
  });

  it("merges server and realtime health without hiding independent failures", () => {
    expect(
      mergeDashboardHealth(
        {
          database: { status: "healthy" },
          r2: { status: "unavailable", message: "R2 belum dikonfigurasi." },
          api: { status: "healthy" },
        },
        { status: "timeout", message: "Waktu habis." },
      ),
    ).toEqual({
      database: { status: "healthy" },
      r2: { status: "unavailable", message: "R2 belum dikonfigurasi." },
      api: { status: "healthy" },
      realtime: { status: "timeout", message: "Waktu habis." },
    });
  });

  it("clamps dashboard periods to now and thirty days", () => {
    const now = Date.parse("2026-08-24T12:00:00.000Z");
    expect(clampDashboardSince("2026-07-01T00:00:00.000Z", now)).toBe("2026-07-25T12:00:00.000Z");
    expect(clampDashboardSince("2026-09-01T00:00:00.000Z", now)).toBe("2026-08-24T12:00:00.000Z");
  });

  it("turns a slow independent check into timeout status", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 1)).resolves.toEqual({
      status: "timeout",
      message: "Waktu habis.",
    });
  });
});
