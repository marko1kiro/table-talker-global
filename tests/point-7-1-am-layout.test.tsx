import { describe, expect, it } from "vitest";
import { AM_NAV } from "../src/components/am/AmLayout";

describe("AM_NAV", () => {
  it("has 7 items with unique routes", () => {
    expect(AM_NAV).toHaveLength(7);
    expect(new Set(AM_NAV.map((n) => n.to)).size).toBe(7);
  });
  it("covers manager, password, audit, meja, statistik, leaderboard", () => {
    const tos = AM_NAV.map((n) => n.to);
    for (const t of [
      "/am/manager",
      "/am/password",
      "/am/audit",
      "/am/meja",
      "/am/statistik",
      "/am/leaderboard",
    ])
      expect(tos).toContain(t);
  });
});
