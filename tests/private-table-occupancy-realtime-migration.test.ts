import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260902235600_private_table_occupancy_realtime.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("L-01 private table occupancy realtime migration", () => {
  it("binds role sessions to auth users without forcing existing sessions to log out", () => {
    expect(sql).toMatch(/add column auth_user_id uuid default auth\.uid\(\)/i);
    expect(sql).not.toMatch(/auth_user_id uuid[^;]*not null/i);
    expect(sql).toMatch(/create or replace function public\.bind_role_session_realtime\(/i);
    expect(sql).toMatch(/rst\.auth_user_id is null or rst\.auth_user_id = v_auth_user_id/i);
    expect(sql).toMatch(/raise exception 'INVALID_SESSION'/i);
  });

  it("authorizes only exact tenant topics for active, unexpired, current-code sessions", () => {
    expect(sql).toMatch(/create or replace function public\.can_read_table_occupancy_broadcast\(/i);
    expect(sql).toMatch(/rst\.auth_user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/rst\.expires_at > now\(\)/i);
    expect(sql).toMatch(/r\.is_active/i);
    expect(sql).toMatch(/rst\.code_version = r\.code_version/i);
    expect(sql).toMatch(/p_topic = 'table-occupancy:' \|\| rst\.restaurant_id::text/i);
  });

  it("creates a broadcast SELECT policy and no browser INSERT policy", () => {
    expect(sql).toMatch(
      /create policy "role sessions read own occupancy broadcasts"[\s\S]*for select[\s\S]*to authenticated/i,
    );
    expect(sql).toMatch(/extension = 'broadcast'/i);
    expect(sql).toMatch(/public\.can_read_table_occupancy_broadcast\(realtime\.topic\(\)\)/i);
    expect(sql).not.toMatch(/create policy[\s\S]{0,160}for insert/i);
  });

  it("replaces every occupancy mutation with private broadcast sends", () => {
    const sends = sql.match(/perform realtime\.send\([\s\S]*?\n\s*\);/gi) ?? [];
    expect(sends).toHaveLength(5);
    for (const send of sends) {
      expect(send).toMatch(/,\s*true\s*\);$/i);
      expect(send).not.toMatch(/,\s*false\s*\);$/i);
    }
  });

  it("grants binding and authorization helpers only to authenticated clients", () => {
    expect(sql).toMatch(
      /revoke all on function public\.bind_role_session_realtime\(uuid, text\) from public, anon, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.bind_role_session_realtime\(uuid, text\) to authenticated/i,
    );
    expect(sql).toMatch(
      /revoke all on function public\.can_read_table_occupancy_broadcast\(text\) from public, anon, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.can_read_table_occupancy_broadcast\(text\) to authenticated/i,
    );
  });
});
