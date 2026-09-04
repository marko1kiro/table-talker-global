import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904112000_manager_realtime_binding.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager realtime binding migration", () => {
  it("adds a manager bind rpc granted to authenticated", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.bind_manager_session_realtime(");
    expect(sql).toContain("update public.manager_sessions");
    expect(sql).toMatch(
      /grant execute on function public\.bind_manager_session_realtime\(uuid, text\) to authenticated/,
    );
  });
  it("extends the broadcast reader with a manager OR-branch requiring aktif + unexpired", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.can_read_table_occupancy_broadcast(");
    expect(sql).toContain("from public.manager_sessions");
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
    expect(sql).toContain("'table-occupancy:' || ms.restaurant_id::text");
  });
  it("keeps the existing crew branch intact", () => {
    const sql = source();
    expect(sql).toContain("from public.role_session_tokens rst");
    expect(sql).toContain("rst.role in ('kasir','satgas','clear_up')");
  });
});
