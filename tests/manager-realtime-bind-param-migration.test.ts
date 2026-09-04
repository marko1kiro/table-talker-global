import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL(
      "../supabase/migrations/20260904120000_fix_manager_realtime_bind_param.sql",
      import.meta.url,
    ),
    "utf8",
  ).toLowerCase();

describe("manager realtime bind param fix migration", () => {
  it("redefines the bind rpc with a p_session_token param (matches the shared hook)", () => {
    const sql = source();
    expect(sql).toContain(
      "drop function if exists public.bind_manager_session_realtime(uuid, text)",
    );
    expect(sql).toContain("create or replace function public.bind_manager_session_realtime(");
    expect(sql).toContain("p_session_token text");
    expect(sql).toContain("extensions.digest(p_session_token, 'sha256')");
    expect(sql).not.toContain("p_manager_token");
  });
  it("keeps the manager validation (aktif + unexpired + restaurant scope)", () => {
    const sql = source();
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
    expect(sql).toContain("update public.manager_sessions");
  });
  it("re-grants execute to authenticated only", () => {
    const sql = source();
    expect(sql).toMatch(
      /grant execute on function public\.bind_manager_session_realtime\(uuid, text\) to authenticated/,
    );
  });
});
