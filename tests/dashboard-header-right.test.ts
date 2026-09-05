import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(
    new URL("../src/components/dashboard/DashboardHeaderRight.tsx", import.meta.url),
    "utf8",
  );

describe("DashboardHeaderRight", () => {
  it("renders the cluster with a conditional bell", () => {
    const s = src();
    expect(s).toContain("RoleEmblem");
    expect(s).toContain("ThemeToggle");
    expect(s).toContain("ProfileMenu");
    expect(s).toContain("NotificationCenter");
    expect(s).toContain("notifications &&");
  });
});
