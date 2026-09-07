import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907200000_add_lookup_rate_limit.sql",
);

describe("lookup rate limit migration", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("creates lookup_rate_limits table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.lookup_rate_limits");
  });

  it("has check_lookup_rate_limit function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.check_lookup_rate_limit");
  });

  it("has record_lookup_failure function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.record_lookup_failure");
  });

  it("has clear_lookup_failures function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.clear_lookup_failures");
  });

  it("blocks after 5 failures in 15 minutes", () => {
    expect(sql).toContain("failures + 1 >= 5");
    expect(sql).toContain("interval '15 minutes'");
  });

  it("revokes public access", () => {
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.check_lookup_rate_limit");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.check_lookup_rate_limit");
  });
});
