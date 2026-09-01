// M-04/M-05 regression tests below need a real IndexedDB to prove the
// actual async transaction ordering/race behavior, not just source
// inspection (see event-flush.test.ts for why this repo otherwise relies
// on source-text checks: no jsdom/browser environment is configured).
// fake-indexeddb implements the spec closely enough to reproduce the
// enqueue/clear race described in the M-05 audit finding.
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEAD_LETTER_MAX_AGE_MS,
  MAX_FLUSH_ATTEMPTS,
  bumpSessionGeneration,
  clearQueuedEvents,
  enqueueEvent,
  generateDeviceId,
  generateEventId,
  getQueuedEvents,
  isDeadLetterEvent,
  pickNextTenantBatch,
  sessionScopeKey,
  __resetEventQueueForTests,
  type PlaybackEvent,
} from "../src/lib/event-queue";

describe("event-queue", () => {
  it("generateEventId returns UUID v4 format", () => {
    const id = generateEventId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generateDeviceId returns string", () => {
    const id = generateDeviceId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });
});

// H-05 remediation (Fase 2, 2026-09-02): dead-letter budget so a batch
// that can never succeed (e.g. a revoked/expired tenant token) doesn't
// grow the IndexedDB queue forever.
describe("isDeadLetterEvent", () => {
  const now = Date.parse("2026-09-02T12:00:00.000Z");

  it("is not dead-letter for a fresh event with no attempts", () => {
    expect(isDeadLetterEvent({ flushAttempts: 0, enqueuedAt: undefined }, now)).toBe(false);
  });

  it("is dead-letter once flushAttempts reaches MAX_FLUSH_ATTEMPTS", () => {
    expect(
      isDeadLetterEvent({ flushAttempts: MAX_FLUSH_ATTEMPTS, enqueuedAt: undefined }, now),
    ).toBe(true);
    expect(
      isDeadLetterEvent({ flushAttempts: MAX_FLUSH_ATTEMPTS - 1, enqueuedAt: undefined }, now),
    ).toBe(false);
  });

  it("is dead-letter once the event has been queued longer than DEAD_LETTER_MAX_AGE_MS", () => {
    const justOver = new Date(now - DEAD_LETTER_MAX_AGE_MS - 1).toISOString();
    const justUnder = new Date(now - DEAD_LETTER_MAX_AGE_MS + 1).toISOString();
    expect(isDeadLetterEvent({ flushAttempts: 0, enqueuedAt: justOver }, now)).toBe(true);
    expect(isDeadLetterEvent({ flushAttempts: 0, enqueuedAt: justUnder }, now)).toBe(false);
  });

  it("does not dead-letter on age alone for legacy events with no enqueuedAt stamp", () => {
    expect(isDeadLetterEvent({ flushAttempts: 0, enqueuedAt: undefined }, now)).toBe(false);
  });

  it("ignores an unparsable enqueuedAt instead of treating it as dead-letter", () => {
    expect(isDeadLetterEvent({ flushAttempts: 0, enqueuedAt: "not-a-date" }, now)).toBe(false);
  });
});

// H-05 remediation: this pure helper is what lets the flush loop skip a
// tenant that already failed this pass and keep making progress on other
// tenants, instead of the old bug where a single failing batch returned
// out of the entire flush.
describe("pickNextTenantBatch", () => {
  const event = (overrides: Partial<PlaybackEvent>): PlaybackEvent => ({
    id: overrides.id ?? "id",
    tenantToken: overrides.tenantToken ?? "tenant-a",
    audioId: "audio-1",
    label: "Announcement",
    eventTimestamp: "2026-09-02T00:00:00.000Z",
    crewSessionId: "crew-1",
    deviceId: "device-1",
    status: "played",
    ...overrides,
  });

  it("returns an empty batch when there are no events", () => {
    expect(pickNextTenantBatch([], new Set(), 10)).toEqual([]);
  });

  it("returns only the first non-excluded tenant's events", () => {
    const events = [
      event({ id: "a1", tenantToken: "tenant-a" }),
      event({ id: "a2", tenantToken: "tenant-a" }),
      event({ id: "b1", tenantToken: "tenant-b" }),
    ];
    const batch = pickNextTenantBatch(events, new Set(), 10);
    expect(batch.map((e) => e.id)).toEqual(["a1", "a2"]);
  });

  it("skips an excluded (already-failed) tenant and picks the next group", () => {
    const events = [
      event({ id: "a1", tenantToken: "tenant-a" }),
      event({ id: "b1", tenantToken: "tenant-b" }),
      event({ id: "b2", tenantToken: "tenant-b" }),
    ];
    const batch = pickNextTenantBatch(events, new Set(["tenant-a"]), 10);
    expect(batch.map((e) => e.id)).toEqual(["b1", "b2"]);
  });

  it("returns an empty batch when every tenant present is excluded", () => {
    const events = [event({ id: "a1", tenantToken: "tenant-a" })];
    const batch = pickNextTenantBatch(events, new Set(["tenant-a"]), 10);
    expect(batch).toEqual([]);
  });

  it("respects batchSize", () => {
    const events = [
      event({ id: "a1", tenantToken: "tenant-a" }),
      event({ id: "a2", tenantToken: "tenant-a" }),
      event({ id: "a3", tenantToken: "tenant-a" }),
    ];
    const batch = pickNextTenantBatch(events, new Set(), 2);
    expect(batch.map((e) => e.id)).toEqual(["a1", "a2"]);
  });
});

// M-04/M-05 remediation (Fase 3, 2026-09-02): the shared-origin IndexedDB
// store is visible to every open tab/session on the same browser, but the
// old `clearQueuedEvents()` took no arguments and unconditionally called
// `.clear()` on the whole object store. Logging out one tab/session
// (Kasir, or the SS soundboard, or even an unrelated info page) silently
// deleted every other tab/session's still-queued, not-yet-flushed
// telemetry too (M-04). Separately, because the clear was fire-and-forget
// (`void clearQueuedEvents()`) with no fencing against `enqueueEvent`'s
// own independent transaction, a `recordEvent` call already in flight
// when logout fired could still land its `put()` after the clear's
// transaction committed, silently reviving a stale event post-logout
// (M-05).
//
// The fix: `clearQueuedEvents(tenantToken, crewSessionId)` now (a) only
// deletes events whose own `tenantToken`/`crewSessionId` match the given
// session -- partitioning by session instead of wiping the whole store --
// and (b) synchronously bumps a per-scope generation counter *before* any
// await, so any `enqueueEvent` call for that same scope that hasn't yet
// reached its post-`openDB()` fencing check will see the bump and drop
// its write instead of reviving a stale event.
function makeEvent(overrides: Partial<PlaybackEvent> = {}): PlaybackEvent {
  return {
    id: overrides.id ?? generateEventId(),
    tenantToken: overrides.tenantToken ?? "tenant-a",
    audioId: "audio-1",
    label: "Announcement",
    eventTimestamp: overrides.eventTimestamp ?? "2026-09-02T00:00:00.000Z",
    crewSessionId: overrides.crewSessionId ?? "crew-1",
    deviceId: "device-1",
    status: "played",
    ...overrides,
  };
}

describe("sessionScopeKey", () => {
  it("combines tenantToken and crewSessionId into a single scope string", () => {
    expect(sessionScopeKey("tenant-a", "crew-1")).toBe("tenant-a:crew-1");
  });

  it("produces distinct keys for different sessions of the same tenant", () => {
    expect(sessionScopeKey("tenant-a", "crew-1")).not.toBe(sessionScopeKey("tenant-a", "crew-2"));
  });
});

describe("clearQueuedEvents (M-04: session-partitioned clear)", () => {
  beforeEach(async () => {
    await __resetEventQueueForTests();
  });
  afterEach(async () => {
    await __resetEventQueueForTests();
  });

  it("removes only events belonging to the given tenantToken/crewSessionId scope", async () => {
    const mine = makeEvent({ id: "mine-1", tenantToken: "tenant-a", crewSessionId: "crew-1" });
    const otherSessionSameTenant = makeEvent({
      id: "other-session-1",
      tenantToken: "tenant-a",
      crewSessionId: "crew-2",
    });
    const otherTenant = makeEvent({
      id: "other-tenant-1",
      tenantToken: "tenant-b",
      crewSessionId: "crew-1",
    });
    await enqueueEvent(mine);
    await enqueueEvent(otherSessionSameTenant);
    await enqueueEvent(otherTenant);

    await clearQueuedEvents("tenant-a", "crew-1");

    const remaining = (await getQueuedEvents()).map((e) => e.id).sort();
    expect(remaining).toEqual(["other-session-1", "other-tenant-1"]);
  });

  it("is a no-op when no events exist for the given scope", async () => {
    const other = makeEvent({ id: "keep-me", tenantToken: "tenant-a", crewSessionId: "crew-2" });
    await enqueueEvent(other);

    await clearQueuedEvents("tenant-a", "crew-1");

    const remaining = (await getQueuedEvents()).map((e) => e.id);
    expect(remaining).toEqual(["keep-me"]);
  });

  it("returns a Promise that only resolves once the deletion has actually completed", async () => {
    const mine = makeEvent({ id: "mine-1", tenantToken: "tenant-a", crewSessionId: "crew-1" });
    await enqueueEvent(mine);

    await clearQueuedEvents("tenant-a", "crew-1");
    // If clearQueuedEvents resolved before the delete transaction actually
    // committed (e.g. a leftover `void`/fire-and-forget internally), this
    // read -- which runs strictly after the awaited call above -- could
    // still observe the stale event.
    const remaining = await getQueuedEvents();
    expect(remaining).toEqual([]);
  });
});

describe("bumpSessionGeneration / enqueueEvent fencing (M-05: enqueue/clear race)", () => {
  beforeEach(async () => {
    await __resetEventQueueForTests();
  });
  afterEach(async () => {
    await __resetEventQueueForTests();
  });

  it("drops an enqueue that is still in flight when its scope is cleared, instead of reviving it", async () => {
    const stale = makeEvent({ id: "stale-1", tenantToken: "tenant-a", crewSessionId: "crew-1" });

    // Start the enqueue but do not await it yet -- this reproduces the
    // M-05 race window where a recordEvent() call is already in flight
    // when logout fires. Do not await this yet.
    const enqueuePromise = enqueueEvent(stale);
    // Fired "concurrently" with the in-flight enqueue above, exactly like
    // logout's clearQueuedEvents() call racing a still-pending recordEvent.
    const clearPromise = clearQueuedEvents("tenant-a", "crew-1");

    await Promise.all([enqueuePromise, clearPromise]);

    const remaining = await getQueuedEvents();
    expect(remaining.find((e) => e.id === "stale-1")).toBeUndefined();
  });

  it("does not drop a write for an unrelated scope when a different scope is cleared concurrently", async () => {
    const unrelated = makeEvent({
      id: "unrelated-1",
      tenantToken: "tenant-a",
      crewSessionId: "crew-OTHER",
    });

    const enqueuePromise = enqueueEvent(unrelated);
    const clearPromise = clearQueuedEvents("tenant-a", "crew-1");

    await Promise.all([enqueuePromise, clearPromise]);

    const remaining = await getQueuedEvents();
    expect(remaining.map((e) => e.id)).toContain("unrelated-1");
  });

  it("still allows a fresh enqueue after a clear has settled (fencing does not permanently block the scope)", async () => {
    await clearQueuedEvents("tenant-a", "crew-1");

    const fresh = makeEvent({ id: "fresh-1", tenantToken: "tenant-a", crewSessionId: "crew-1" });
    await enqueueEvent(fresh);

    const remaining = await getQueuedEvents();
    expect(remaining.map((e) => e.id)).toContain("fresh-1");
  });

  it("bumpSessionGeneration increments a per-scope counter", () => {
    const scope = sessionScopeKey("tenant-z", "crew-z");
    const first = bumpSessionGeneration(scope);
    const second = bumpSessionGeneration(scope);
    expect(second).toBeGreaterThan(first);
  });
});
