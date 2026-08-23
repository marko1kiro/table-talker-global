import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root), "utf8");

it("provides automatic thirty-day owner retention", () => {
  const migration = file("supabase/migrations/20260824005000_owner_retention.sql");
  expect(migration).toContain("cleanup_owner_retention");
  expect(migration.match(/interval '30 days'/g)).toHaveLength(3);
  expect(migration).toContain("playback_events");
  expect(migration).toContain("operational_errors");
  expect(migration).toContain("owner_broadcasts");
  expect(migration).toContain("owner-retention-daily");
  expect(existsSync(new URL("supabase/functions/owner-retention/index.ts", root))).toBe(true);
});

it("keeps retention off browser routes", () => {
  for (const path of [
    "src/routes/super-admin/index.tsx",
    "src/routes/super-admin/history.tsx",
    "src/routes/super-admin/error-log.tsx",
  ]) {
    expect(file(path)).not.toContain("cleanup_owner_retention");
  }
});
