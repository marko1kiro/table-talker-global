import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const eventFlush = () =>
  readFileSync(new URL("../src/lib/event-flush.ts", import.meta.url), "utf8");

it("imports enqueueEvent, getQueuedEvents, removeEvents", () => {
  const source = eventFlush();
  expect(source).toContain("enqueueEvent");
  expect(source).toContain("getQueuedEvents");
  expect(source).toContain("removeEvents");
});

it("uses BATCH_SIZE of 10", () => {
  const source = eventFlush();
  expect(source).toContain("BATCH_SIZE = 10");
});

it("uses FLUSH_INTERVAL_MS of 30_000", () => {
  const source = eventFlush();
  expect(source).toContain("FLUSH_INTERVAL_MS = 30_000");
});

it("flushes on pagehide event", () => {
  const source = eventFlush();
  expect(source).toContain("pagehide");
});

it("drains queued events in bounded batches", () => {
  const source = eventFlush();
  expect(source).toContain("MAX_BATCHES_PER_FLUSH");
  expect(source).toContain("for (let batchIndex");
});

it("uses beacon or keepalive transport during pagehide", () => {
  const source = eventFlush();
  expect(source).toMatch(/sendBeacon|keepalive/);
});

it("exports useEventFlush hook", () => {
  const source = eventFlush();
  expect(source).toContain("export function useEventFlush");
});

it("uses bounded memory mirror synchronously during pagehide without deleting events", () => {
  const source = eventFlush();
  expect(source).toContain("PAGEHIDE_MIRROR_LIMIT");
  expect(source).toContain("pagehideEventsRef");
  const pagehide = source.match(/const handlePageHide = \(\) => \{[\s\S]*?\n    \};/);
  expect(pagehide).not.toBeNull();
  expect(pagehide?.[0]).not.toContain("getQueuedEvents");
  expect(pagehide?.[0]).not.toContain("removeEvents");
  expect(pagehide?.[0]).toContain("sendBeacon");
  expect(source).toContain("new Map(pagehideEventsRef.current.map");
});

it("includes required crew session token in pagehide telemetry payload", () => {
  const source = eventFlush();
  const pagehide = source.match(/const handlePageHide = \(\) => \{[\s\S]*?\n    \};/);
  expect(pagehide).not.toBeNull();
  expect(pagehide?.[0]).toMatch(/JSON\.stringify\(\{ tenantToken: batch\[0\]\.tenantToken, crewSessionToken, events: batch \}\)/);
});

it("prestages event in memory before awaiting IndexedDB", () => {
  const source = eventFlush();
  const recordEvent = source.match(/async \(event: PlaybackEvent\) => \{[\s\S]*?\n    \},/);
  expect(recordEvent).not.toBeNull();
  const body = recordEvent?.[0] ?? "";
  expect(body.indexOf("mirrorEvents")).toBeLessThan(body.indexOf("await enqueueEvent"));
});
