import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904113000_manager_reads.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager reads migration", () => {
  it("defines snapshot + active-crew rpcs validated by the manager token", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.get_manager_snapshot(");
    expect(sql).toContain("create or replace function public.get_manager_active_crew(");
    expect(sql).toContain("encode(extensions.digest(p_manager_token, 'sha256'), 'hex')");
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
  });
  it("scopes every read to the session's own restaurant (no client-supplied id)", () => {
    const sql = source();
    expect(sql).toContain("v_restaurant");
    expect(sql).not.toContain("p_restaurant_id");
  });
  it("active crew joins tokens to sessions and filters unexpired", () => {
    const sql = source();
    expect(sql).toContain("from public.role_session_tokens rst");
    expect(sql).toContain("join public.crew_role_sessions crs");
    expect(sql).toContain("rst.expires_at > now()");
  });
  it("grants both reads to authenticated", () => {
    const sql = source();
    expect(sql).toMatch(
      /grant execute on function public\.get_manager_snapshot\(text\) to authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_manager_active_crew\(text\) to authenticated/,
    );
  });
});
