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

it("exports loginToRestaurant with server-only PIN verification and scoped token", () => {
  const source = server();
  expect(source).toContain("loginToRestaurant");
  expect(source).toContain("verifyRestaurantPin");
  expect(source).toContain("createTenantSession");
  expect(source).toContain('rpc("check_tenant_login_rate_limit"');
  expect(source).toContain("pin_hash");
  expect(source).toContain("Resto tidak aktif");
  expect(source).toContain("restaurant_sessions");
});

it("exports getRestaurantManifest that queries active audio_manifests", () => {
  const source = server();
  expect(source).toContain("getRestaurantManifest");
  expect(source).toContain('from("audio_manifests")');
  expect(source).toContain("content_hash");
  expect(source).toContain("byte_size");
});
