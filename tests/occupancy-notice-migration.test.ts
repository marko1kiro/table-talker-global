import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const url = new URL(
  "../supabase/migrations/20260904090000_occupancy_notice_payload.sql",
  import.meta.url,
);
const source = () => readFileSync(url, "utf8").toLowerCase();

describe("occupancy notice payload migration", () => {
  it("redefines all six broadcast rpcs", () => {
    const sql = source();
    for (const fn of [
      "set_table_occupied_kasir",
      "set_table_empty_cleanup",
      "create_escort_intent",
      "confirm_escort_intent",
      "record_qr_scan",
      "decline_qr_scan",
    ]) {
      expect(sql).toContain(`create or replace function public.${fn}(`);
    }
  });

  it("adds kind/actor fields to every send", () => {
    const sql = source();
    expect(sql).toContain("'kind'");
    expect(sql).toContain("'actor_role'");
    expect(sql).toContain("'actor_name'");
    expect(sql).toContain("'actor_role_session_id'");
    expect(sql).toContain("crew_role_sessions crs");
  });

  it("keeps the private send flag and invalidate event", () => {
    const sql = source();
    const sends = sql.match(/perform realtime\.send\([\s\S]*?\n\s*\);/g) ?? [];
    expect(sends.length).toBeGreaterThanOrEqual(6);
    for (const s of sends) {
      expect(s).toContain("'invalidate'");
      expect(s).toMatch(/,\s*true\s*\)/);
    }
  });
});
