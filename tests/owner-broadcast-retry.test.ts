import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { shouldResetBroadcastIdempotencyKey } from "../src/lib/owner-broadcast-retry";

describe("owner broadcast retry key", () => {
  it("keeps same key for in-progress and recoverable responses", () => {
    expect(shouldResetBroadcastIdempotencyKey({ ok: false, code: "IN_PROGRESS" })).toBe(false);
    expect(shouldResetBroadcastIdempotencyKey({ ok: false, code: "UNAVAILABLE" })).toBe(false);
  });

  it("resets key after terminal responses", () => {
    expect(shouldResetBroadcastIdempotencyKey({ ok: true })).toBe(true);
    expect(shouldResetBroadcastIdempotencyKey({ ok: false, code: "RATE_LIMITED" })).toBe(true);
    expect(shouldResetBroadcastIdempotencyKey({ ok: false, code: "IDEMPOTENCY_CONFLICT" })).toBe(
      true,
    );
    expect(shouldResetBroadcastIdempotencyKey({ ok: false, code: "RESTAURANT_NOT_FOUND" })).toBe(
      true,
    );
  });

  it("reuses ref key after IN_PROGRESS retry", () => {
    const route = readFileSync(
      new URL("../src/routes/super-admin/broadcast.tsx", import.meta.url),
      "utf8",
    );
    expect(route).toContain("idempotencyKey: (idempotencyKey.current ??= crypto.randomUUID())");
    expect(route).toContain("shouldResetBroadcastIdempotencyKey(data)");
  });
});
