import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260904111000_manager_auth.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager auth rpcs migration", () => {
  it("defines register / get_credential / create_session", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.register_manager(");
    expect(sql).toContain("create or replace function public.get_manager_credential(");
    expect(sql).toContain("create or replace function public.create_manager_session(");
  });
  it("register resolves an active restaurant by code and rejects a duplicate id", () => {
    const sql = source();
    expect(sql).toContain("from public.restaurants");
    expect(sql).toContain("is_active");
    expect(sql).toContain("id_manager");
  });
  it("create_session stores a sha256 hash and returns the plaintext token once", () => {
    const sql = source();
    expect(sql).toContain("extensions.digest(v_token, 'sha256')");
    expect(sql).toContain("return v_token");
  });
  it("grants the three auth rpcs to service_role only", () => {
    const sql = source();
    expect(sql).toMatch(
      /grant execute on function public\.register_manager\(text, text, text, text\) to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.get_manager_credential\(text\) to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.create_manager_session\(uuid\) to service_role/,
    );
  });
});
