import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/20260903004900_reject_unbound_role_session_realtime.sql",
  import.meta.url,
);

describe("L-01 role-session realtime bind NULL guard remediation", () => {
  it("ships a follow-up migration that rejects a zero-row binding update", () => {
    expect(existsSync(migrationUrl)).toBe(true);
    if (!existsSync(migrationUrl)) return;

    const sql = readFileSync(migrationUrl, "utf8");
    expect(sql).toMatch(/create or replace function public\.bind_role_session_realtime\(/i);
    expect(sql).toMatch(/if not coalesce\(v_bound, false\) then/i);
    expect(sql).toMatch(/raise exception 'INVALID_SESSION'/i);
  });

  it("preserves authenticated-only execution grants", () => {
    if (!existsSync(migrationUrl)) return;

    const sql = readFileSync(migrationUrl, "utf8");
    expect(sql).toMatch(
      /revoke all on function public\.bind_role_session_realtime\(uuid, text\) from public, anon, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.bind_role_session_realtime\(uuid, text\) to authenticated/i,
    );
  });
});
