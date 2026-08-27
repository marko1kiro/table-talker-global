import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260822100000_restaurant_sessions.sql", import.meta.url),
  "utf8",
);

it("creates daily tenant session table with unique restaurant+date", () => {
  expect(migrationSource).toMatch(/create table public\.restaurant_sessions \(/i);
  expect(migrationSource).toMatch(
    /create unique index restaurant_sessions_restaurant_date_key\s+on public\.restaurant_sessions \(restaurant_id, session_date\)/is,
  );
  expect(migrationSource).toMatch(/session_date date not null default current_date/i);
  expect(migrationSource).toMatch(/constraint restaurant_sessions_restaurant_id_fkey/i);
});

it("denies anon and authenticated access and enables RLS", () => {
  expect(migrationSource).toMatch(/enable row level security/i);
  expect(migrationSource).toMatch(
    /revoke all on public\.restaurant_sessions from anon, authenticated/i,
  );
});
