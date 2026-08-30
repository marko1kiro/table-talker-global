import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/lib/esb-app-id.server.ts", import.meta.url), "utf8");

// ESB App ID Panel -- see docs/superpowers/specs/
// 2026-08-30-esb-app-id-panel-qr-export-design.md, decision 3 (light auth
// only, not requireRecentSuperAdmin -- esb_app_id is configuration data,
// not a security credential like the restaurant login code).

it("exports listRestaurantsForEsbPanel, getRestaurantEsbAppId and setRestaurantEsbAppId", () => {
  const file = source();
  expect(file).toContain("export const listRestaurantsForEsbPanel");
  expect(file).toContain("export const getRestaurantEsbAppId");
  expect(file).toContain("export const setRestaurantEsbAppId");
});

it("uses light auth (requireSuperAdmin) only, never requireRecentSuperAdmin", () => {
  const file = source();
  expect(file).toContain("requireSuperAdmin");
  expect(file).not.toContain("requireRecentSuperAdmin");
});

it("reads directly from the restaurants table via the service-role client, not owner_restaurant_list", () => {
  const file = source();
  expect(file).toContain("getServiceClient");
  expect(file).toContain('.from("restaurants")');
  expect(file).not.toContain('rpc("owner_restaurant_list"');
  expect(file).not.toContain("owner-restaurants.server");
});

it("selects id, display_name and esb_app_id for the restaurant dropdown", () => {
  const listBlock = source().slice(source().indexOf("export const listRestaurantsForEsbPanel"));
  expect(listBlock).toMatch(
    /select\(\s*["'`][^"'`]*\bid\b[^"'`]*\bdisplay_name\b[^"'`]*\besb_app_id\b/,
  );
});

it("validates esb_app_id as a non-empty, bounded plain string before saving", () => {
  const file = source();
  expect(file).toContain("z.string()");
});

it("sets no-store cache headers on every handler, matching the admin-restaurants.server.ts convention", () => {
  const file = source();
  expect(file).toContain('setResponseHeader("Cache-Control", "no-store")');
  const noStoreCalls = file.match(/\bnoStore\(\);/g)?.length ?? 0;
  expect(noStoreCalls).toBeGreaterThanOrEqual(3);
});
