import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260831214101_optimize_table_occupancy_snapshot.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("Task 16 compact occupancy snapshot migration", () => {
  it("replaces the existing RPC without changing its signature or return contract", () => {
    expect(sql).toMatch(/create or replace function public\.get_table_occupancy_snapshot\(/i);
    expect(sql).toMatch(/p_restaurant_id uuid/i);
    expect(sql).toMatch(/p_session_token text/i);
    expect(sql).toMatch(
      /returns table\s*\(\s*table_number integer,\s*status text,\s*occupied_at timestamptz,\s*occupied_source text\s*\)/i,
    );
  });

  it("preserves role-session validation and excludes SS", () => {
    expect(sql).toMatch(/from public\.role_session_tokens/i);
    expect(sql).toMatch(/restaurant_id = p_restaurant_id/i);
    expect(sql).toMatch(/role <> 'ss'/i);
    expect(sql).toMatch(/expires_at > now\(\)/i);
    expect(sql).toMatch(/raise exception 'INVALID_SESSION'/i);
  });

  it("returns only persisted TERISI rows rather than materializing all 100 tables", () => {
    expect(sql).toMatch(/from public\.table_occupancy_state tos/i);
    expect(sql).toMatch(/tos\.restaurant_id = p_restaurant_id/i);
    expect(sql).toMatch(/tos\.status = 'terisi'/i);
    expect(sql).toMatch(/order by tos\.table_number/i);
    expect(sql).not.toMatch(/generate_series/i);
    expect(sql).not.toMatch(/left join/i);
  });

  it("keeps the RPC-only permission boundary", () => {
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = (?:pg_catalog, )?public/i);
    expect(sql).toMatch(
      /revoke all on function public\.get_table_occupancy_snapshot\(uuid, text\) from public, anon, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_table_occupancy_snapshot\(uuid, text\) to authenticated/i,
    );
  });
});
