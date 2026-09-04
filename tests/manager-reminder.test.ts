import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildStaleNotices, TWO_HOURS_MS } from "../src/lib/manager-reminder";
import type { TableOccupancyRow } from "../src/lib/table-occupancy.server";

const HOUR = 3_600_000;
function row(n: number, occupiedAtMs: number | null): TableOccupancyRow {
  return {
    tableNumber: n,
    status: occupiedAtMs === null ? "kosong" : "terisi",
    occupiedAt: occupiedAtMs === null ? null : new Date(occupiedAtMs).toISOString(),
    occupiedSource: null,
    escortIntentId: null,
    escortIntentExpiresAt: null,
    escortIntentMine: false,
  };
}

describe("buildStaleNotices", () => {
  const now = 1_000_000_000_000;
  it("returns structured items for tables > 2h, longest first", () => {
    expect(
      buildStaleNotices(
        [row(49, now - (2 * HOUR + 37 * 60_000)), row(5, now - HOUR), row(12, now - 3 * HOUR)],
        now,
      ),
    ).toEqual([
      { table: 12, duration: "3 JAM" },
      { table: 49, duration: "2 JAM 37 MENIT" },
    ]);
  });
  it("empty when nothing exceeds 2h", () => {
    expect(buildStaleNotices([row(1, now - TWO_HOURS_MS)], now)).toEqual([]);
  });
  it("ignores empty tables", () => {
    expect(buildStaleNotices([row(1, null)], now)).toEqual([]);
  });
});

describe("manager-reminder module surface", () => {
  it("no longer exports the rotating-string helpers", () => {
    const s = readFileSync(new URL("../src/lib/manager-reminder.ts", import.meta.url), "utf8");
    expect(s).not.toContain("buildStaleReminders");
    expect(s).not.toContain("rotateIndex");
  });
});
