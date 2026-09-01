import { describe, expect, it } from "vitest";
import {
  DEAD_LETTER_MAX_AGE_MS,
  MAX_FLUSH_ATTEMPTS,
  generateDeviceId,
  generateEventId,
  isDeadLetterEvent,
  pickNextTenantBatch,
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
