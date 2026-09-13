import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Poin 3 Task 9 (hard cutover): the restaurant code that lands on a role
// identity is no longer client-supplied via the deleted loginToRestaurant/
// RoleLoginFlow path -- it is derived SERVER-side by crew_shift_claim from the
// account's paired restaurant and handed straight to the identity. These
// assertions pin that chain end-to-end so the SS/role handoff keeps carrying a
// real code without any crew-owned input.
const migration = () =>
  readFileSync(
    new URL("../supabase/migrations/20260913120000_crew_shift_claim.sql", import.meta.url),
    "utf8",
  );
const server = () =>
  readFileSync(new URL("../src/lib/crew-auth.server.ts", import.meta.url), "utf8");
const flow = () =>
  readFileSync(new URL("../src/components/CrewLoginFlow.tsx", import.meta.url), "utf8");

describe("restaurant code plumbing (Poin 3 server-derived)", () => {
  it("crew_shift_claim returns restaurant_code straight from the paired restaurant row", () => {
    const sql = migration();
    expect(sql).toMatch(/'restaurant_code',\s*v_rest\.code/);
  });

  it("crew-auth.server maps restaurant_code onto the typed result", () => {
    expect(server()).toMatch(/restaurantCode:\s*payload\.restaurant_code/);
  });

  it("CrewLoginFlow stores the server-derived code as restaurantCode on the role identity", () => {
    expect(flow()).toContain("restaurantCode: result.restaurantCode");
  });
});
