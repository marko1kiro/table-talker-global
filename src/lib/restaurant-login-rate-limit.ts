export type RestaurantLoginRateLimit = {
  failures: number;
  windowStartedAt: number;
  blockedUntil: number | null;
};

export type RestaurantLoginRateLimitState = {
  global: Map<string, RestaurantLoginRateLimit>;
  lookup: Map<string, RestaurantLoginRateLimit>;
};

export function applyRestaurantLoginFailure(
  limit: RestaurantLoginRateLimit,
  now: number,
): RestaurantLoginRateLimit {
  if (limit.blockedUntil !== null && limit.blockedUntil > now) return limit;
  const expired = limit.windowStartedAt <= now - 15 * 60 * 1000;
  const failures = expired ? 1 : limit.failures + 1;
  const windowStartedAt = expired ? now : limit.windowStartedAt;
  return {
    failures,
    windowStartedAt,
    blockedUntil: failures >= 5 ? now + 15 * 60 * 1000 : null,
  };
}

const emptyLimit = (): RestaurantLoginRateLimit => ({
  failures: 0,
  windowStartedAt: 0,
  blockedUntil: null,
});

export function completeRestaurantLoginAttempt(
  state: RestaurantLoginRateLimitState,
  buckets: readonly [string, string],
  success: boolean,
  now: number,
): RestaurantLoginRateLimitState | null {
  const uniqueBuckets = [...new Set(buckets)];
  const blocked = (limits: Map<string, RestaurantLoginRateLimit>) =>
    uniqueBuckets.some((bucket) => (limits.get(bucket)?.blockedUntil ?? 0) > now);
  if (blocked(state.global) || blocked(state.lookup)) return null;

  const global = new Map(state.global);
  const lookup = new Map(state.lookup);
  for (const bucket of uniqueBuckets) {
    if (success) {
      global.delete(bucket);
      lookup.delete(bucket);
    } else {
      global.set(bucket, applyRestaurantLoginFailure(global.get(bucket) ?? emptyLimit(), now));
      lookup.set(bucket, applyRestaurantLoginFailure(lookup.get(bucket) ?? emptyLimit(), now));
    }
  }
  return { global, lookup };
}
