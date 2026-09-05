import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/CrewShell.tsx", import.meta.url), "utf8");

describe("CrewShell", () => {
  it("mobile-first header: logo + unified cluster, feed-only bell, no sidebar", () => {
    const s = src();
    expect(s).toContain("ThemeFrame");
    expect(s).toContain("lime-logo.webp");
    expect(s).toContain("DashboardHeaderRight");
    expect(s).toContain("stale: []");
    expect(s).not.toContain("md:flex");
  });
});
