import { describe, expect, it } from "vitest";
import { buildManagerCsv } from "../src/lib/manager-csv-export";
import type { DailyStatsResult } from "../src/lib/manager-stats.server";
import type { CrewHistoryRow } from "../src/lib/manager-dashboard.server";

const stats: DailyStatsResult & { ok: true } = {
  ok: true,
  totalServed: 5,
  avgDurationMinutes: 18.2,
  peakHour: 12,
  perTable: [
    {
      tableNumber: 1,
      timesOccupied: 2,
      totalMinutes: 36.4,
      avgMinutes: 18.2,
    },
    { tableNumber: 2, timesOccupied: 0, totalMinutes: 0, avgMinutes: null },
  ],
};

const crew: CrewHistoryRow[] = [
  {
    role: "kasir",
    displayName: "Rina",
    checkedInAt: "2026-09-07T03:00:00Z",
    isActive: true,
  },
];

describe("buildManagerCsv", () => {
  it("contains Ringkasan Harian section", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Ringkasan Harian");
  });
  it("contains Occupancy Per Meja section", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Occupancy Per Meja");
  });
  it("contains Crew History section", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Crew History");
  });
  it("includes stat values in ringkasan", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("5");
    expect(csv).toContain("18.2");
    expect(csv).toContain("12:00 WIB");
  });
  it("includes crew row", () => {
    const csv = buildManagerCsv(stats, crew, "2026-09-07");
    expect(csv).toContain("Rina");
    expect(csv).toContain("kasir");
  });
  it("handles empty data", () => {
    const empty: DailyStatsResult & { ok: true } = {
      ok: true,
      totalServed: 0,
      avgDurationMinutes: null,
      peakHour: null,
      perTable: [],
    };
    const csv = buildManagerCsv(empty, [], "2026-09-07");
    expect(csv).toContain("Ringkasan Harian");
    expect(csv).toContain("0");
  });
});
