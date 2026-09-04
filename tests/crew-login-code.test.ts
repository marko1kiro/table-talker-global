import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = () =>
  readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");
const flow = () =>
  readFileSync(new URL("../src/components/RoleLoginFlow.tsx", import.meta.url), "utf8");

describe("restaurant code plumbing", () => {
  it("loginToRestaurant returns the validated code", () => {
    expect(server()).toMatch(/restaurantId:\s*login\.p_rid,[\s\S]*code:\s*validated\.code/);
  });
  it("RoleLoginFlow stores the code as restaurantCode on the role identity", () => {
    expect(flow()).toContain("restaurantCode: login.code");
    expect(flow()).toMatch(/type LoginResult = \{[\s\S]*code: string;/);
  });
});
