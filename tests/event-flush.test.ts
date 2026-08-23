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
