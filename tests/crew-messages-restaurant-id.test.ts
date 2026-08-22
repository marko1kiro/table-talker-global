import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260822100020_crew_messages_restaurant_id.sql", import.meta.url),
  "utf8",
);

it("adds restaurant_id foreign key to crew_messages", () => {
  expect(migrationSource).toMatch(/alter table public\.crew_messages\s+add column/i);
  expect(migrationSource).toMatch(/restaurant_id uuid/i);
  expect(migrationSource).toMatch(/references public\.restaurants \(id\) on delete restrict/i);
  expect(migrationSource).toMatch(/not null/i);
});

it("backfills crew_messages from crew_sessions", () => {
  expect(migrationSource).toMatch(/update public\.crew_messages/i);
  expect(migrationSource).toMatch(/from public\.crew_sessions/i);
});

it("updates create_crew_message to accept restaurant_id", () => {
  expect(migrationSource).toMatch(/create or replace function public\.create_crew_message\(/i);
  expect(migrationSource).toMatch(/p_restaurant_id uuid/i);
});
