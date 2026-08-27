import { expect, it } from "vitest";
import { isOwnerQueryKey } from "../src/lib/owner-query-cache";

it("matches only owner-scoped React Query namespaces", () => {
  expect(isOwnerQueryKey(["owner-dashboard"])).toBe(true);
  expect(isOwnerQueryKey(["owner-manifest", "restaurant-1"])).toBe(true);
  expect(isOwnerQueryKey(["owner-operational-errors"])).toBe(true);
  expect(isOwnerQueryKey(["manifest", "restaurant-1"])).toBe(false);
  expect(isOwnerQueryKey(["crew-manifest", "restaurant-1"])).toBe(false);
  expect(isOwnerQueryKey([])).toBe(false);
});
