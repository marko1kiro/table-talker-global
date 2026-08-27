import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const adminSource = readFileSync(
  new URL("../src/lib/admin-restaurants.server.ts", import.meta.url),
  "utf8",
);
const crewSource = readFileSync(
  new URL("../src/lib/restaurants.server.ts", import.meta.url),
  "utf8",
);

it("uses keyed exact-code lookup and one generic failure at crew boundary", () => {
  expect(crewSource).toContain("validateRestaurantCode(data.code)");
  expect(crewSource).toContain('hashRestaurantCode(valid ? validated.code : "\\n", key)');
  expect(crewSource).not.toContain("hashLegacyRestaurantCode");
  expect(crewSource).not.toContain('.ilike("code"');
  expect(crewSource).not.toContain("verifyLegacyRestaurantPin");
  expect(crewSource).not.toContain("pin_hash");
  expect([...crewSource.matchAll(/Kode Resto salah\./g)]).toHaveLength(1);
});

it("keeps owner credential handlers server-only, audited, and no-store", () => {
  for (const name of [
    "createRestaurant",
    "viewRestaurantCode",
    "changeRestaurantCode",
    "deactivateRestaurant",
  ])
    expect(adminSource).toContain(`export const ${name}`);
  expect(adminSource).toContain("await requireSuperAdmin()");
  expect(adminSource).toContain("encryptRestaurantCode");
  expect(adminSource).toContain("decryptRestaurantCode");
  expect(adminSource).toContain("writeRestaurantCredentialAudit");
  expect(adminSource).toContain('setResponseHeader("Cache-Control", "no-store")');
  expect(adminSource).not.toMatch(/console\.(log|error).*code/i);
});

it("requires server-verified Super Admin re-entry before credential destruction", () => {
  expect(adminSource).toContain("superAdminPassword: z.string().min(1)");
  expect(adminSource).toContain("requireRecentSuperAdmin(data.superAdminPassword)");
  const dialog = readFileSync(
    new URL("../src/components/RestaurantCredentialDialog.tsx", import.meta.url),
    "utf8",
  );
  expect(dialog).toContain("Password Super Admin");
  expect(dialog).toContain("superAdminPassword");
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
