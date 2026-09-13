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

it("Poin 3 cutover: the crew code+PIN login fns are gone, getRestaurantManifest stays", () => {
  const source = crewServer();
  // loginToRestaurant / verifyRestaurantPin had zero src consumers once
  // RoleLoginFlow was deleted (crew_shift_claim mints the tenant token now), so
  // the hard cutover removed them. The SS soundboard still needs the manifest.
  expect(source).not.toContain("loginToRestaurant");
  expect(source).not.toContain("verifyRestaurantPin");
  expect(source).not.toContain('from("restaurant_sessions").upsert');
  expect(source).toContain("getRestaurantManifest");
  expect(source).toContain('from("audio_manifests")');
  expect(source).toContain("content_hash");
  expect(source).toContain("byte_size");
});
