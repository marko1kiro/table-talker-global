import { describe, expect, it } from "vitest";
import { groupActiveCrewByStation, formatWibClock } from "../src/lib/manager-crew-groups";
import type { ActiveCrewRow } from "../src/lib/manager-dashboard.server";

describe("formatWibClock", () => {
  it("renders HH:MM:SS WIB from an ISO instant (UTC+7)", () => {
    expect(formatWibClock("2026-09-04T10:00:12Z")).toBe("17:00:12 WIB");
  });
});

describe("groupActiveCrewByStation", () => {
  it("groups by station in fixed order, dropping empty stations", () => {
    const rows: ActiveCrewRow[] = [
      { role: "clear_up", displayName: "Dadan", checkedInAt: "2026-09-04T10:00:00Z" },
      { role: "kasir", displayName: "Rina", checkedInAt: "2026-09-04T09:00:00Z" },
      { role: "kasir", displayName: "Sari", checkedInAt: "2026-09-04T09:30:00Z" },
    ];
    const groups = groupActiveCrewByStation(rows);
    expect(groups.map((g) => g.label)).toEqual(["SELF SERVICE", "KASIR", "SATGAS", "CLEAR UP"]);
    expect(groups[1].members.map((m) => m.displayName)).toEqual(["Rina", "Sari"]);
    expect(groups[0].members).toHaveLength(0);
  });
});
