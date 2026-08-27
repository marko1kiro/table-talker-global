import { expect, it } from "vitest";
import {
  applyRestaurantLoginFailure,
  completeRestaurantLoginAttempt,
  type RestaurantLoginRateLimitState,
  type RestaurantLoginRateLimit,
} from "../src/lib/restaurant-login-rate-limit";

it("blocks sixth serialized failure after admission reserves five failures", () => {
  let limit: RestaurantLoginRateLimit = { failures: 0, windowStartedAt: 0, blockedUntil: null };

  for (let attempt = 0; attempt < 5; attempt++) limit = applyRestaurantLoginFailure(limit, attempt);

  expect(limit).toMatchObject({ failures: 5, blockedUntil: 15 * 60 * 1000 + 4 });
  expect(applyRestaurantLoginFailure(limit, 5 * 60 * 1000)).toBe(limit);
});

it("dedupes equal client and IP buckets before failure update", () => {
  const state: RestaurantLoginRateLimitState = {
    global: new Map([["same", { failures: 0, windowStartedAt: 0, blockedUntil: null }]]),
    lookup: new Map([["same", { failures: 0, windowStartedAt: 0, blockedUntil: null }]]),
  };

  const result = completeRestaurantLoginAttempt(state, ["same", "same"], false, 1);

  expect(result).not.toBeNull();
  expect(result!.global.get("same")?.failures).toBe(1);
  expect(result!.lookup.get("same")?.failures).toBe(1);
});

it("rejects blocked attempt before restaurant lookup", () => {
  const blocked: RestaurantLoginRateLimit = {
    failures: 5,
    windowStartedAt: 0,
    blockedUntil: 15 * 60 * 1000,
  };
  const state: RestaurantLoginRateLimitState = {
    global: new Map([["client", blocked]]),
    lookup: new Map([["client", blocked]]),
  };

  expect(completeRestaurantLoginAttempt(state, ["client", "ip"], false, 1)).toBeNull();
});

it("fifth failed attempt updates both global and lookup buckets", () => {
  const nearBlocked: RestaurantLoginRateLimit = {
    failures: 4,
    windowStartedAt: 0,
    blockedUntil: null,
  };
  const state: RestaurantLoginRateLimitState = {
    global: new Map([
      ["client", nearBlocked],
      ["ip", nearBlocked],
    ]),
    lookup: new Map([
      ["client", nearBlocked],
      ["ip", nearBlocked],
    ]),
  };

  const result = completeRestaurantLoginAttempt(state, ["client", "ip"], false, 1);

  for (const limits of [result?.global, result?.lookup])
    for (const bucket of ["client", "ip"])
      expect(limits?.get(bucket)).toMatchObject({ failures: 5, blockedUntil: 15 * 60 * 1000 + 1 });
});

it("row-lock serial order keeps failure before success cleared and later failure retained", () => {
  const existing: RestaurantLoginRateLimit = {
    failures: 2,
    windowStartedAt: 0,
    blockedUntil: null,
  };
  const state: RestaurantLoginRateLimitState = {
    global: new Map([["client", existing]]),
    lookup: new Map([["client", existing]]),
  };

  const cleared = completeRestaurantLoginAttempt(state, ["client", "ip"], true, 1)!;
  const failed = completeRestaurantLoginAttempt(cleared, ["client", "ip"], false, 2)!;

  expect(failed.global.get("client")?.failures).toBe(1);
  expect(failed.lookup.get("client")?.failures).toBe(1);
});
