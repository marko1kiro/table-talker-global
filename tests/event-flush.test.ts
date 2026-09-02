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

// L-03: the keepalive fetch fallback in handlePageHide must handle its own
// rejection. `void fetch(...)` without a catch turns a failed unload
// delivery into an unhandled promise rejection (browser console noise).
// Events remain durably queued in IndexedDB, so swallowing here is correct.
it("handles keepalive fetch rejection in pagehide instead of leaving an unhandled rejection (L-03)", () => {
  const source = eventFlush();
  const pagehide = source.match(/const handlePageHide = \(\) => \{[\s\S]*?\n {4}\};/);
  expect(pagehide).not.toBeNull();
  const body = pagehide?.[0] ?? "";
  expect(body).toMatch(/void fetch\("\/api\/telemetry"/);
  expect(body).toMatch(/void fetch\("\/api\/telemetry"[\s\S]*?\.catch\(/);
});

it("exports useEventFlush hook", () => {
  const source = eventFlush();
  expect(source).toContain("export function useEventFlush");
});

it("uses bounded memory mirror synchronously during pagehide without deleting events", () => {
  const source = eventFlush();
  expect(source).toContain("PAGEHIDE_MIRROR_LIMIT");
  expect(source).toContain("pagehideEventsRef");
  const pagehide = source.match(/const handlePageHide = \(\) => \{[\s\S]*?\n {4}\};/);
  expect(pagehide).not.toBeNull();
  expect(pagehide?.[0]).not.toContain("getQueuedEvents");
  expect(pagehide?.[0]).not.toContain("removeEvents");
  expect(pagehide?.[0]).toContain("sendBeacon");
  expect(source).toContain("new Map(pagehideEventsRef.current.map");
});

it("includes required crew session token in pagehide telemetry payload", () => {
  const source = eventFlush();
  const pagehide = source.match(/const handlePageHide = \(\) => \{[\s\S]*?\n {4}\};/);
  expect(pagehide).not.toBeNull();
  const body = pagehide?.[0] ?? "";
  expect(body).toContain("JSON.stringify({");
  expect(body).toContain("tenantToken: batch[0].tenantToken");
  expect(body).toContain("crewSessionToken");
  expect(body).toContain("events: batch");
});

it("prestages event in memory before awaiting IndexedDB", () => {
  const source = eventFlush();
  const recordEvent = source.match(/async \(event: PlaybackEvent\) => \{[\s\S]*?\n {4}\},/);
  expect(recordEvent).not.toBeNull();
  const body = recordEvent?.[0] ?? "";
  expect(body.indexOf("mirrorEvents")).toBeLessThan(body.indexOf("await enqueueEvent"));
});

// H-05 remediation (Fase 2, 2026-09-02): a failed batch must no longer
// abort the entire flush -- it must skip that tenant and keep trying
// other queued tenants/groups in the same pass.
it("does not abort the whole flush when a batch fails (H-05)", () => {
  const source = eventFlush();
  const flushBody = source.match(
    /const flush = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[flushToServer\]\);/,
  );
  expect(flushBody).not.toBeNull();
  const body = flushBody?.[0] ?? "";
  expect(body).toContain("failedTenants");
  expect(body).toContain("pickNextTenantBatch");
  // The old bug: `if (!result.ok) return;` unconditionally exited the
  // whole flush. It must now `continue` to the next loop iteration
  // instead, after recording the tenant as failed for this pass.
  expect(body).not.toMatch(/if \(!result\.ok\)\s*return;/);
  const failureBranch = body.match(/if \(!result\.ok\) \{[\s\S]*?\n {8}\}/);
  expect(failureBranch).not.toBeNull();
  expect(failureBranch?.[0]).toContain("failedTenants.add");
  expect(failureBranch?.[0]).toContain("markFlushAttempts");
  expect(failureBranch?.[0]).toContain("continue");
});

it("drops dead-letter events instead of retrying them forever (H-05)", () => {
  const source = eventFlush();
  expect(source).toContain("isDeadLetterEvent");
  expect(source).toContain("removeEvents(deadIds)");
  expect(source).toMatch(/console\.warn\(/);
});

it("imports the new H-05 event-queue helpers", () => {
  const source = eventFlush();
  expect(source).toContain("isDeadLetterEvent");
  expect(source).toContain("markFlushAttempts");
  expect(source).toContain("pickNextTenantBatch");
});
