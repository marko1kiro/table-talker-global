import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260822100010_crew_sessions_restaurant_id.sql", import.meta.url),
  "utf8",
);

it("adds restaurant_id foreign key to crew_sessions", () => {
  expect(migrationSource).toMatch(/alter table public\.crew_sessions\s+add column/i);
  expect(migrationSource).toMatch(/restaurant_id uuid/i);
  expect(migrationSource).toMatch(/references public\.restaurants \(id\) on delete restrict/i);
  expect(migrationSource).toMatch(/not null/i);
});

it("backfills existing crew_sessions with pilot restaurant", () => {
  expect(migrationSource).toMatch(/update public\.crew_sessions/i);
  expect(migrationSource).toMatch(
    /set restaurant_id = \(select id from public\.restaurants where lower\(code\) = 'kampung-bulu'\)/i,
  );
});

it("updates claim_crew_session to accept restaurant_id", () => {
  expect(migrationSource).toMatch(/create or replace function public\.claim_crew_session\(/i);
  expect(migrationSource).toMatch(/p_restaurant_id uuid/i);
  expect(migrationSource).toMatch(/RESTAURANT_INACTIVE/i);
});
