import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = readFileSync(new URL("../src/lib/restaurants.server.ts", import.meta.url), "utf8");

it("uses keyed exact-code lookup and one generic failure at crew boundary", () => {
  expect(source).toContain("validateRestaurantCode(data.code)");
  expect(source).toContain("hashRestaurantCode(validated.code");
  expect(source).toContain('.eq("code_hash", codeHash)');
  expect(source).not.toContain('.ilike("code"');
  expect(source).not.toContain("verifyLegacyRestaurantPin");
  expect(source).not.toContain("pin_hash");
  expect([...source.matchAll(/Kode Resto salah\./g)]).toHaveLength(1);
});

it("keeps owner credential handlers server-only, audited, and no-store", () => {
  for (const name of ["createRestaurant", "listRestaurants", "getRestaurantDetail", "viewRestaurantCode", "changeRestaurantCode", "deactivateRestaurant"])
    expect(source).toContain(`export const ${name}`);
  expect(source).toContain("await requireSuperAdmin()");
  expect(source).toContain("encryptRestaurantCode");
  expect(source).toContain("decryptRestaurantCode");
  expect(source).toContain("writeRestaurantCredentialAudit");
  expect(source).toContain('setResponseHeader("Cache-Control", "no-store")');
  expect(source).not.toMatch(/console\.(log|error).*code/i);
});

it("never serializes credential material to audit or operational records", async () => {
  const { serializeRestaurantCredentialAudit } = await import("../src/lib/restaurant-audit.server");
  expect(
    serializeRestaurantCredentialAudit({
      operation: "restaurant.code_rotated",
      reason: "duplicate",
      code: "Z".repeat(6),
      code_hash: "hmac-sha256:v1:value",
      code_encrypted: "aes-256-gcm:v1:value:value:value",
      tenantToken: "bearer-value",
    }),
  ).toBe('{"operation":"restaurant.code_rotated","reason":"duplicate"}');
});
