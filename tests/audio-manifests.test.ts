import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260822110000_audio_manifests.sql", import.meta.url),
  "utf8",
);

it("creates audio_manifests table with restaurant FK and catalog versioning", () => {
  expect(migrationSource).toMatch(/create table public\.audio_manifests \(/i);
  expect(migrationSource).toMatch(/restaurant_id uuid not null/i);
  expect(migrationSource).toMatch(/references public\.restaurants \(id\) on delete cascade/i);
  expect(migrationSource).toMatch(/audio_id text not null/i);
  expect(migrationSource).toMatch(/r2_url text not null/i);
  expect(migrationSource).toMatch(/content_hash text not null/i);
  expect(migrationSource).toMatch(/byte_size integer not null/i);
  expect(migrationSource).toMatch(/catalog_version integer not null default 1/i);
});

it("creates unique index on restaurant+audio+version", () => {
  expect(migrationSource).toMatch(
    /create unique index audio_manifests_restaurant_audio_version_idx/i,
  );
});

it("enables RLS and grants select to authenticated", () => {
  expect(migrationSource).toMatch(/enable row level security/i);
  expect(migrationSource).toMatch(/grant select on public\.audio_manifests to authenticated/i);
});
