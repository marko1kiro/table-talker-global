import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const file = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("protects bounded owner history queries", () => {
  const source = file("src/lib/owner-history.server.ts");
  expect(source).toContain("await requireSuperAdmin()");
  expect(source).toContain('type: z.enum(["playback", "sync"])');
  expect(source).toContain("normalizeHistoryRange");
  expect(source).toContain("normalizeHistorySearch");
  expect(source).toContain("PAGE_SIZE = 50");
  expect(source).toContain('.order("occurred_at", { ascending: false })');
});

it("filters safe operational error fields and records resolution metadata", () => {
  const source = file("src/lib/operational-errors.server.ts");
  expect(source).toContain("restaurantId: z.string().uuid().optional()");
  expect(source).toContain("resolution_note");
  expect(source).toContain("resolved_by");
  expect(source).not.toContain('.select("*"');
  expect(source).toContain('code: "ALREADY_RESOLVED"');
  expect(source).toContain('code: "NOT_FOUND"');
});

it("adds resolution fields and owner history indexes", () => {
  const migration = file(
    "supabase/migrations/20260824003000_owner_history_error_log.sql",
  );
  expect(migration).toContain("resolution_note");
  expect(migration).toContain("resolved_by");
  expect(migration).toContain("operational_errors_owner_filter_idx");
  expect(migration).toContain("playback_events_owner_history_idx");
});
