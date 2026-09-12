import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/routes/super-admin/route.tsx", import.meta.url), "utf8");

describe("super-admin header", () => {
  it("uses the unified cluster as SUPER ADMIN with no notification bell", () => {
    const s = src();
    expect(s).toContain("DashboardHeaderRight");
    expect(s).toContain('roleLabel="SUPER ADMIN"');
    expect(s).toContain("canChangePassword: profile.data?.individual === true");
    expect(s).not.toContain("NotificationCenter");
  });
});
