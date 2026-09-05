import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () => readFileSync(new URL("../src/routes/kasir/index.tsx", import.meta.url), "utf8");

describe("kasir route (SP2 + desktop correction)", () => {
  it("uses the responsive AppShell + full header cluster, dark grid, notification feed", () => {
    const s = src();
    expect(s).toContain("AppShell");
    expect(s).toContain("DashboardHeaderRight");
    expect(s).toContain('roleLabel="KASIR"');
    expect(s).toContain("useNotificationCenter");
    expect(s).toContain("feed: items");
    expect(s).not.toContain("CrewShell");
    expect(s).not.toContain("<CrewHeader");
    expect(s).toContain("dark:bg-emerald-500/10");
  });
});
