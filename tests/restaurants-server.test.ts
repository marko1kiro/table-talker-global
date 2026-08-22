import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const server = () =>
  readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");

it("exports createRestaurant bound to service-role client behind super admin", () => {
  const source = server();
  expect(source).toContain('createServerFn({ method: "POST" })');
  expect(source).toContain("await requireSuperAdmin();");
  expect(source).toContain('client.from("restaurants").insert');
  expect(source).toContain("restaurants_code_key");
});

it("exports loginToRestaurant with PIN validation and session creation", () => {
  const source = server();
  expect(source).toContain("loginToRestaurant");
  expect(source).toContain("validateTenantLogin");
  expect(source).toContain("Resto tidak aktif");
  expect(source).toContain("restaurant_sessions");
});
