import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const playbackEvents = readFileSync(
  new URL("../supabase/migrations/20260822120000_playback_events.sql", import.meta.url),
  "utf8",
);

const operationalErrors = readFileSync(
  new URL("../supabase/migrations/20260822120010_operational_errors.sql", import.meta.url),
  "utf8",
);

it("playback_events has restaurant FK and status check", () => {
  expect(playbackEvents).toMatch(/create table public\.playback_events \(/i);
  expect(playbackEvents).toMatch(/restaurant_id uuid/i);
  expect(playbackEvents).toMatch(/references public\.restaurants \(id\) on delete cascade/i);
  expect(playbackEvents).toMatch(/status text not null check.*played.*failed/i);
  expect(playbackEvents).toMatch(/audio_id text not null/i);
  expect(playbackEvents).toMatch(/crew_name text not null/i);
  expect(playbackEvents).toMatch(/device_id text not null/i);
});

it("playback_events has indexes for restaurant queries", () => {
  expect(playbackEvents).toMatch(/playback_events_restaurant_ts_idx/i);
  expect(playbackEvents).toMatch(/playback_events_restaurant_audio_idx/i);
});

it("operational_errors has stage, report_code, and resolution", () => {
  expect(operationalErrors).toMatch(/create table public\.operational_errors \(/i);
  expect(operationalErrors).toMatch(/stage text not null/i);
  expect(operationalErrors).toMatch(/report_code text not null/i);
  expect(operationalErrors).toMatch(/resolved_at timestamptz/i);
  expect(operationalErrors).toMatch(/restaurant_id uuid/i);
});

it("operational_errors has partial index for unresolved errors", () => {
  expect(operationalErrors).toMatch(/operational_errors_unresolved_idx/i);
  expect(operationalErrors).toMatch(/where resolved_at is null/i);
});
