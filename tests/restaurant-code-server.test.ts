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

it("uses a direct plain-code lookup and one generic failure at crew boundary", () => {
  expect(crewSource).toContain("validateRestaurantCode(data.code)");
  expect(crewSource).toContain('p_code: valid ? validated.code : "\\n"');
  expect(crewSource).not.toContain("hashRestaurantCode");
  expect(crewSource).not.toContain("hashLegacyRestaurantCode");
  expect(crewSource).not.toContain('.ilike("code"');
  expect(crewSource).not.toContain("verifyLegacyRestaurantPin");
  expect([...crewSource.matchAll(/Kode Resto salah\./g)]).toHaveLength(1);
});

// C-01 remediation (Fase 1, 2026-09-02): restaurants.pin (plaintext) was
// replaced with restaurants.pin_hash (sha256 hex). This file's Kode Resto
// (restaurant code) lookup above stays intentionally plain-text -- codes are
// not treated as a secret -- but the separate "ID Resto" PIN second-factor,
// verified in this same file, must now compare against the hashed column.
it("verifies the ID Resto PIN second factor against the hashed column, not plaintext", () => {
  expect(crewSource).toContain("restaurant.pin_hash !== hashOpaqueRestaurantToken(data.pin)");
  expect(crewSource).not.toContain('.select("pin")');
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
  expect(adminSource).toContain("writeRestaurantCredentialAudit");
  expect(adminSource).toContain('setResponseHeader("Cache-Control", "no-store")');
  expect(adminSource).not.toContain("encryptRestaurantCode");
  expect(adminSource).not.toContain("decryptRestaurantCode");
  expect(adminSource).not.toContain("hashRestaurantCode");
  expect(adminSource).not.toContain("RESTAURANT_CODE_ENCRYPTION_KEY");
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
      tenantToken: "bearer-value",
    }),
  ).toBe('{"operation":"restaurant.code_rotated","reason":"duplicate"}');
});
