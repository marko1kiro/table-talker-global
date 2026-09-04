import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const text = () =>
  readFileSync(new URL("../src/components/RoleLoginFlow.tsx", import.meta.url), "utf8");

describe("manager entry button", () => {
  it("offers a separated MANAGER login above the crew area", () => {
    expect(text()).toContain("MANAGER");
    expect(text()).toContain('to="/manager/login"');
  });
});
