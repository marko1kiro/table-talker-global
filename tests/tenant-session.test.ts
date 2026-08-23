import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  createTenantSession,
  hashRestaurantPin,
  verifyRestaurantPin,
  verifyTenantSession,
} from "../src/lib/tenant-session.server";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root), "utf8");

it("adds server-only tenant session and PIN migration", () => {
  expect(existsSync(new URL("src/lib/tenant-session.server.ts", root))).toBe(true);
  expect(existsSync(new URL("supabase/migrations/20260823102000_restaurant_pin_hash.sql", root))).toBe(true);
});

it("keeps PIN verifiers out of client code and UI", () => {
  expect(file("src/lib/restaurant-domain.ts")).not.toContain("TENANT_PIN");
  expect(file("src/components/CrewIdentityDialog.tsx")).not.toContain("123456");
});

it("verifies stored SHA-256 PIN hashes and signs expiring restaurant tokens", () => {
  const hash = "c482cc7de4a25c8602e43eb0531452e99ee9ff62b60a831b0be7587b68517d22";
  expect(verifyRestaurantPin("tenant-pin", hash)).toBe(true);
  expect(verifyRestaurantPin("wrong", hash)).toBe(false);

  const token = createTenantSession("restaurant-id", 1_000);
  expect(verifyTenantSession(token, 1_001)).toEqual({ restaurantId: "restaurant-id", expiresAt: 3_601_000 });
  expect(verifyTenantSession(`${token}x`, 1_001)).toBeNull();
});

it("hashes owner-supplied PINs before persistence", () => {
  expect(hashRestaurantPin("tenant-pin")).toBe("c482cc7de4a25c8602e43eb0531452e99ee9ff62b60a831b0be7587b68517d22");
  expect(file("src/lib/restaurants.server.ts")).toContain("export const setRestaurantPin");
  expect(file("src/lib/restaurants.server.ts")).toContain("await requireSuperAdmin()");
});
