import { expect, it } from "vitest";

import {
  createOpaqueRestaurantToken,
  hashOpaqueRestaurantToken,
} from "../src/lib/restaurant-session.server";

it("creates random opaque bearer tokens whose hashes are independent of restaurant credentials", () => {
  const first = createOpaqueRestaurantToken();
  const second = createOpaqueRestaurantToken();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second).not.toBe(first);
  expect(hashOpaqueRestaurantToken(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(hashOpaqueRestaurantToken(first)).not.toBe(hashOpaqueRestaurantToken(second));
});
