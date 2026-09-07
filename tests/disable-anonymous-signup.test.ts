import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907210000_disable_anonymous_signup.sql",
);

describe("disable anonymous signup migration", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("creates system_config table", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.system_config");
  });

  it("sets anonymous_signup_enabled to false by default", () => {
    expect(sql).toContain("'anonymous_signup_enabled', 'false'");
  });

  it("has is_anonymous_signup_enabled function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.is_anonymous_signup_enabled()");
  });

  it("has set_anonymous_signup_enabled function", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.set_anonymous_signup_enabled");
  });

  it("grants is_anonymous_signup_enabled to anon and authenticated", () => {
    expect(sql).toContain(
      "GRANT EXECUTE ON FUNCTION public.is_anonymous_signup_enabled() TO anon, authenticated",
    );
  });

  it("restricts set_anonymous_signup_enabled to service_role only", () => {
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.is_anonymous_signup_enabled(), public.set_anonymous_signup_enabled",
    );
  });
});
