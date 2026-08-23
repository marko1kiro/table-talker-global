import { describe, expect, it } from "vitest";
import {
  DASHBOARD_SYNC_FAILURE_STAGES,
  mergeDashboardHealth,
  withTimeout,
} from "../src/lib/owner-dashboard-domain";

describe("owner dashboard domain", () => {
  it("keeps sync failure stages aligned with operational error allowlist", () => {
    expect(DASHBOARD_SYNC_FAILURE_STAGES).toEqual(["sync_cache"]);
  });

  it("merges independent health failures without hiding healthy checks", () => {
    expect(
      mergeDashboardHealth({
        database: { status: "healthy" },
        r2: { status: "unavailable", message: "R2 belum dikonfigurasi." },
        api: { status: "healthy" },
      }),
    ).toEqual({
      database: { status: "healthy" },
      r2: { status: "unavailable", message: "R2 belum dikonfigurasi." },
      api: { status: "healthy" },
    });
  });

  it("turns a slow independent check into timeout status", async () => {
    await expect(withTimeout(new Promise<never>(() => {}), 1)).resolves.toEqual({
      status: "timeout",
      message: "Waktu habis.",
    });
  });
});
