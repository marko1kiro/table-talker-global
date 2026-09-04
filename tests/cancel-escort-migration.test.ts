import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const url = new URL(
  "../supabase/migrations/20260904100000_cancel_escort_intent.sql",
  import.meta.url,
);
const source = () => readFileSync(url, "utf8").toLowerCase();

describe("cancel_escort_intent migration", () => {
  it("defines the rpc and resolves (not deletes) the intent", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.cancel_escort_intent(");
    expect(sql).toContain("set resolved = true");
    expect(sql).not.toContain("delete from public.table_escort_intents");
  });

  it("allows any satgas at the restaurant (no actor_session_id restriction)", () => {
    const sql = source();
    expect(sql).toContain("rst.role = 'satgas'");
    expect(sql).toContain("restaurant_id = v_session.restaurant_id");
    expect(sql).not.toContain("actor_session_id = v_session.role_session_id");
  });

  it("bumps revision and broadcasts a kind-less invalidate (refetch, no toast)", () => {
    const sql = source();
    expect(sql).toContain("bump_table_occupancy_revision");
    expect(sql).toMatch(/perform realtime\.send\([\s\S]*?'invalidate'[\s\S]*?,\s*true\s*\)/);
    expect(sql).not.toContain("'kind'");
  });

  it("grants execute to authenticated only", () => {
    const sql = source();
    expect(sql).toMatch(
      /revoke all on function public\.cancel_escort_intent\(uuid, text\) from public, anon, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.cancel_escort_intent\(uuid, text\) to authenticated/,
    );
  });
});
