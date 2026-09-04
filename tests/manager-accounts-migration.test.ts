import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904110000_manager_accounts.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager_accounts migration", () => {
  it("creates both tables with rls and full revokes", () => {
    const sql = source();
    expect(sql).toContain("create table public.manager_accounts");
    expect(sql).toContain("create table public.manager_sessions");
    expect(sql).toContain("alter table public.manager_accounts enable row level security");
    expect(sql).toContain("alter table public.manager_sessions enable row level security");
    expect(sql).toContain("revoke all on public.manager_accounts from public, anon, authenticated");
    expect(sql).toContain("revoke all on public.manager_sessions from public, anon, authenticated");
  });
  it("enforces a unique global id_manager and an aktif/nonaktif status", () => {
    const sql = source();
    expect(sql).toContain("create unique index manager_accounts_id_manager_key");
    expect(sql).toContain("check (status in ('aktif','nonaktif'))");
    expect(sql).toContain("default 'aktif'");
  });
  it("scopes both tables to a restaurant and cascades on delete", () => {
    const sql = source();
    expect(sql).toContain("references public.restaurants(id) on delete cascade");
    expect(sql).toContain("references public.manager_accounts(id) on delete cascade");
  });
});
