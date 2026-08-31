// Task 12: pure, framework-free logic for the Clear Up route's occupied-
// table queue -- filtering to currently-TERISI tables, computing duration
// entirely client-side from `occupied_at`, and sorting descending by that
// duration (longest-occupied first). Kept separate from the route so it
// can be unit-tested directly, matching this codebase's established
// pattern (see satgas-escort-waitlist.ts / .test.ts).
import { describe, expect, it } from "vitest";
import { formatOccupiedDuration, sortedOccupiedTables } from "../src/lib/clear-up-queue";
import type { TableOccupancyRow } from "../src/lib/table-occupancy.server";

function row(overrides: Partial<TableOccupancyRow>): TableOccupancyRow {
  return {
    tableNumber: 1,
    status: "kosong",
    occupiedAt: null,
    occupiedSource: null,
    ...overrides,
  };
}

describe("sortedOccupiedTables", () => {
  const now = new Date("2026-09-01T10:00:00.000Z").getTime();

  it("excludes kosong tables entirely", () => {
    const tables = [row({ tableNumber: 1, status: "kosong" })];
    expect(sortedOccupiedTables(tables, now)).toEqual([]);
  });

  it("a table that has never been terisi (never appears with occupied_at) never appears", () => {
    const tables = [row({ tableNumber: 1, status: "kosong", occupiedAt: null })];
    expect(sortedOccupiedTables(tables, now)).toHaveLength(0);
  });

  it("includes terisi tables with their duration computed from occupied_at, not any extra field", () => {
    const occupiedAt = new Date(now - 5 * 60_000).toISOString(); // 5 minutes ago
    const tables = [row({ tableNumber: 7, status: "terisi", occupiedAt })];
    const result = sortedOccupiedTables(tables, now);
    expect(result).toHaveLength(1);
    expect(result[0].tableNumber).toBe(7);
    expect(result[0].durationMs).toBe(5 * 60_000);
  });

  it("sorts descending by duration -- longest-occupied table first", () => {
    const tables = [
      row({
        tableNumber: 1,
        status: "terisi",
        occupiedAt: new Date(now - 2 * 60_000).toISOString(),
      }),
      row({
        tableNumber: 2,
        status: "terisi",
        occupiedAt: new Date(now - 30 * 60_000).toISOString(),
      }),
      row({
        tableNumber: 3,
        status: "terisi",
        occupiedAt: new Date(now - 10 * 60_000).toISOString(),
      }),
    ];
    const result = sortedOccupiedTables(tables, now);
    expect(result.map((entry) => entry.tableNumber)).toEqual([2, 3, 1]);
  });

  it("treats a terisi row with a null/malformed occupied_at as excluded rather than crashing", () => {
    const tables = [
      row({ tableNumber: 1, status: "terisi", occupiedAt: null }),
      row({ tableNumber: 2, status: "terisi", occupiedAt: "not-a-date" }),
    ];
    expect(sortedOccupiedTables(tables, now)).toEqual([]);
  });

  it("clamps a duration that would be negative (clock skew: occupied_at slightly in the future) to zero rather than a negative number", () => {
    const tables = [
      row({ tableNumber: 5, status: "terisi", occupiedAt: new Date(now + 5_000).toISOString() }),
    ];
    const result = sortedOccupiedTables(tables, now);
    expect(result).toHaveLength(1);
    expect(result[0].durationMs).toBe(0);
  });

  it("computes duration purely from the given now value and occupied_at -- no Date.now() call inside", () => {
    // Calling twice with two different `now` values for the same input
    // table must produce two different durations, proving the function is
    // a pure function of its arguments (this is what lets the route avoid
    // any extra server call merely to keep the duration display live).
    const occupiedAt = new Date(now - 60_000).toISOString();
    const tables = [row({ tableNumber: 9, status: "terisi", occupiedAt })];
    const first = sortedOccupiedTables(tables, now)[0].durationMs;
    const second = sortedOccupiedTables(tables, now + 60_000)[0].durationMs;
    expect(second - first).toBe(60_000);
  });
});

describe("formatOccupiedDuration", () => {
  it('renders "Baru saja" for under a minute', () => {
    expect(formatOccupiedDuration(0)).toBe("Baru saja");
    expect(formatOccupiedDuration(30_000)).toBe("Baru saja");
  });

  it("renders whole minutes under an hour", () => {
    expect(formatOccupiedDuration(5 * 60_000)).toBe("5 menit");
    expect(formatOccupiedDuration(59 * 60_000)).toBe("59 menit");
  });

  it("renders hours with no leftover minutes without a dangling '0 menit'", () => {
    expect(formatOccupiedDuration(60 * 60_000)).toBe("1 jam");
    expect(formatOccupiedDuration(2 * 60 * 60_000)).toBe("2 jam");
  });

  it("renders hours plus remaining minutes", () => {
    expect(formatOccupiedDuration(75 * 60_000)).toBe("1 jam 15 menit");
    expect(formatOccupiedDuration(3 * 60 * 60_000 + 40 * 60_000)).toBe("3 jam 40 menit");
  });

  it("never renders a negative duration", () => {
    expect(formatOccupiedDuration(-10_000)).toBe("Baru saja");
  });
});
