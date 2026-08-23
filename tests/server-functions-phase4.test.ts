import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const playbackServer = () =>
  readFileSync(new URL("../src/lib/playback-events.server.ts", import.meta.url), "utf8");

const errorsServer = () =>
  readFileSync(new URL("../src/lib/operational-errors.server.ts", import.meta.url), "utf8");

it("playback-events.server has batch ingest with upsert on id", () => {
  const source = playbackServer();
  expect(source).toContain("ingestPlaybackEvents");
  expect(source).toContain('from("playback_events")');
  expect(source).toContain("upsert");
  expect(source).toContain('onConflict: "id"');
  expect(source).toContain("ignoreDuplicates: true");
});

it("playback-events.server has cleanup with olderThanDays", () => {
  const source = playbackServer();
  expect(source).toContain("cleanupOldPlaybackEvents");
  expect(source).toContain("olderThanDays");
  expect(source).toContain(".lt(");
});

it("operational-errors.server has report, list, and resolve functions", () => {
  const source = errorsServer();
  expect(source).toContain("reportOperationalError");
  expect(source).toContain("listOperationalErrors");
  expect(source).toContain("resolveOperationalError");
  expect(source).toContain('from("operational_errors")');
});

it("operational-errors.server supports resolved filter and pagination", () => {
  const source = errorsServer();
  expect(source).toContain("resolved");
  expect(source).toContain("limit");
  expect(source).toContain("offset");
  expect(source).toContain("resolved_at");
});
