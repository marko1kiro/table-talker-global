import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const crewServer = () =>
  readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");
const adminServer = () =>
  readFileSync(new URL("../src/lib/admin-restaurants.server.ts", import.meta.url), "utf8");

it("exports createRestaurant bound to service-role client behind super admin", () => {
  const source = adminServer();
  expect(source).toContain('createServerFn({ method: "POST" })');
  expect(source).toContain("await requireSuperAdmin();");
  expect(source).toContain('client.from("restaurants").insert');
  expect(source).toContain("code: validated.code");
  expect(source).not.toContain("code_hash");
  expect(source).not.toContain("code_encrypted");
});

it("initializes every required restaurant credential field before auditing creation", () => {
  const source = adminServer();
  expect(source).toMatch(
    /code: validated\.code,[\s\S]*code_version: 1,[\s\S]*credential_rotated_at: new Date\(\)\.toISOString\(\)/,
  );
  expect(source).toMatch(
    /await writeRestaurantCredentialAudit\(client, \{[\s\S]*operation: "created",[\s\S]*success: !error/,
  );
});

it("delegates restaurant login atomically through service-role RPC with a plain code, no rate limiting", () => {
  const source = crewServer();
  expect(source).toContain("loginToRestaurant");
  expect(source).toContain("createOpaqueRestaurantToken");
  expect(source).toContain('client.rpc("login_to_restaurant_atomic"');
  expect(source).toContain("p_code:");
  expect(source).toContain("p_token_hash:");
  expect(source).toContain("p_expires_at:");
  expect(source).not.toContain("p_lookup_hash");
  expect(source).not.toContain("p_client_bucket_hash");
  expect(source).not.toContain("p_ip_bucket_hash");
  expect(source).not.toContain("getLoginRateLimitBuckets");
  expect(source).not.toContain("check_tenant_login_rate_limit");
  expect(source).not.toContain('from("restaurant_sessions").upsert');
  expect(source).toContain("Kode Resto salah.");
});

it("exports getRestaurantManifest that queries active audio_manifests", () => {
  const source = crewServer();
  expect(source).toContain("getRestaurantManifest");
  expect(source).toContain('from("audio_manifests")');
  expect(source).toContain("content_hash");
  expect(source).toContain("byte_size");
});
