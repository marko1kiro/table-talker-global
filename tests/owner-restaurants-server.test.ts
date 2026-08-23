import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/lib/owner-restaurants.server.ts", import.meta.url), "utf8");

it("uses super-admin authorization before owner restaurant service calls", () => {
  const file = source();
  expect(file).toContain("export const listOwnerRestaurants");
  expect(file).toContain("export const getOwnerRestaurantDetail");
  expect(file).toContain("await requireSuperAdmin();");
  expect(file).toContain('rpc("owner_restaurant_list")');
  expect(file).toContain('rpc("owner_restaurant_detail"');
});

it("uses UUID validation and stable owner result codes", () => {
  const file = source();
  expect(file).toContain("z.string().uuid()");
  expect(file).toContain('code: "UNAVAILABLE"');
  expect(file).toContain('code: "NOT_FOUND"');
  expect(file).toContain("if (error) return unavailable()");
  expect(file).not.toContain("error.message.includes");
});
