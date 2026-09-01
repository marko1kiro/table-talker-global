import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// M-04/M-05 remediation (Fase 3, 2026-09-02): src/routes/index.tsx's
// invalidateCrewSession() and logout() both called
// `removeCrewSessionIdentity(...)` followed by a bare, unawaited, no-arg
// `void clearQueuedEvents()`. That:
//   - M-04: wiped every tab/session's queued telemetry sharing the same
//     origin's IndexedDB store, not just this session's.
//   - M-05: raced any in-flight recordEvent()'s own enqueueEvent()
//     transaction, which could commit its `put()` after the clear's
//     `.clear()` already ran, silently reviving a stale event.
//
// event-queue.ts's clearQueuedEvents(tenantToken, crewSessionId) now
// partitions by session and fences enqueueEvent() against a generation
// bump (see tests/event-queue.test.ts). This file locks in that both
// call sites in routes/index.tsx capture the identity being logged out
// *before* it's wiped, and actually await the scoped clear.
//
// No jsdom/testing-library harness is configured in this repo, so -- in
// line with the existing pattern (see event-flush.test.ts,
// tests/soundboard-sync-wiring.test.ts) -- these are source-inspection
// assertions rather than a mounted-component test.

function extractCallback(source: string, name: string): string {
  const marker = `const ${name} = useCallback(`;
  const start = source.indexOf(marker);
  expect(start, `expected to find "${marker}" in source`).toBeGreaterThan(-1);
  // Find the matching closing `}, [` of this useCallback's body by
  // bracket-depth scanning from the opening brace of the arrow body.
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let i = bodyStart;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

describe("routes/index.tsx: invalidateCrewSession is session-scoped and awaited (M-04/M-05)", () => {
  const page = source("../src/routes/index.tsx");
  const body = extractCallback(page, "invalidateCrewSession");

  it("is declared as an async callback", () => {
    expect(page).toContain("const invalidateCrewSession = useCallback(async () => {");
  });

  it("captures crewIdentityRef.current before removeCrewSessionIdentity wipes storage", () => {
    const captureIndex = body.indexOf("crewIdentityRef.current");
    const removeIndex = body.indexOf("removeCrewSessionIdentity(");
    expect(captureIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(removeIndex);
  });

  it("awaits a scoped clearQueuedEvents call using the captured identity, not a bare void call", () => {
    expect(body).not.toContain("void clearQueuedEvents()");
    expect(body).toMatch(
      /await clearQueuedEvents\(\s*[\w.?]+\.tenantToken,\s*[\w.?]+\.crewSessionId\s*\)/,
    );
  });
});

describe("routes/index.tsx: logout is session-scoped and awaited (M-04/M-05)", () => {
  const page = source("../src/routes/index.tsx");
  const body = extractCallback(page, "logout");

  it("is declared as an async callback", () => {
    expect(page).toContain("const logout = useCallback(async () => {");
  });

  it("captures crewIdentityRef.current before removeCrewSessionIdentity wipes storage", () => {
    const captureIndex = body.indexOf("crewIdentityRef.current");
    const removeIndex = body.indexOf("removeCrewSessionIdentity(");
    expect(captureIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(-1);
    expect(captureIndex).toBeLessThan(removeIndex);
  });

  it("awaits a scoped clearQueuedEvents call using the captured identity, not a bare void call", () => {
    expect(body).not.toContain("void clearQueuedEvents()");
    expect(body).toMatch(
      /await clearQueuedEvents\(\s*[\w.?]+\.tenantToken,\s*[\w.?]+\.crewSessionId\s*\)/,
    );
  });
});

describe("routes/index.tsx: no remaining unscoped clearQueuedEvents() calls", () => {
  it("never calls clearQueuedEvents with zero arguments", () => {
    const page = source("../src/routes/index.tsx");
    expect(page).not.toMatch(/clearQueuedEvents\(\)/);
  });
});
