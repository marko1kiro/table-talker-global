import { describe, expect, it } from "vitest";
import { buildStaleReminders, rotateIndex, TWO_HOURS_MS } from "../src/lib/manager-reminder";
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

describe("buildStaleReminders", () => {
  const now = 1_000_000_000_000;
  it("includes only tables occupied > 2h, longest first", () => {
    const lines = buildStaleReminders(
      [row(49, now - (2 * HOUR + 37 * 60_000)), row(5, now - HOUR), row(12, now - 3 * HOUR)],
      now,
    );
    expect(lines).toEqual([
      "MEJA 12 | >3 JAM | PERLU DI CEK",
      "MEJA 49 | >2 JAM 37 MENIT | PERLU DI CEK",
    ]);
  });
  it("returns empty when nothing exceeds 2h", () => {
    expect(buildStaleReminders([row(1, now - TWO_HOURS_MS)], now)).toEqual([]);
  });
  it("ignores empty tables", () => {
    expect(buildStaleReminders([row(1, null)], now)).toEqual([]);
  });
});

describe("rotateIndex", () => {
  it("cycles within bounds and is 0 for an empty list", () => {
    expect(rotateIndex(0, 5)).toBe(0);
    expect(rotateIndex(3, 0)).toBe(0);
    expect(rotateIndex(3, 1)).toBe(1);
    expect(rotateIndex(3, 3)).toBe(0);
    expect(rotateIndex(3, 4)).toBe(1);
  });
});
