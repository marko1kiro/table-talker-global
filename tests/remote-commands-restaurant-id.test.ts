import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260822100030_remote_commands_restaurant_id.sql",
    import.meta.url,
  ),
  "utf8",
);

it("adds restaurant_id foreign key to remote_commands", () => {
  expect(migrationSource).toMatch(/alter table public\.remote_commands\s+add column/i);
  expect(migrationSource).toMatch(/restaurant_id uuid/i);
  expect(migrationSource).toMatch(/references public\.restaurants \(id\) on delete restrict/i);
  expect(migrationSource).toMatch(/not null/i);
});

it("backfills remote_commands from crew_sessions", () => {
  expect(migrationSource).toMatch(/update public\.remote_commands/i);
  expect(migrationSource).toMatch(/from public\.crew_sessions/i);
});
