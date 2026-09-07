import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Role Login Flow Header UI", () => {
  it("displays logo, tagline 'Simplify Your Workflow' and removes 'Login Dulu'", () => {
    const filePath = join(process.cwd(), "src/components/RoleLoginFlow.tsx");
    const content = readFileSync(filePath, "utf-8");
    expect(content).not.toContain("Login Dulu");
    expect(content).not.toContain("Masuk ke station kamu untuk mulai bertugas.");
    expect(content).toContain("Simplify Your Workflow");
    expect(content).toContain("/lime-logo.webp");
  });
});
