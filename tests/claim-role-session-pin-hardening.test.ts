import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260907180000_fix_pin_rate_limit_bucket.sql",
);

describe("claim_role_session pin rate limit bucketing", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("uses only restaurant bucket (no tenant bucket)", () => {
    expect(sql).not.toContain("v_tenant_bucket");
    expect(sql).toContain("v_restaurant_bucket");
  });

  it("buckets by restaurant hash only in rate limit insert", () => {
    expect(sql).toContain(
      "insert into public.role_session_pin_attempts(bucket_hash)\n  values (v_restaurant_bucket)",
    );
  });

  it("checks blocked_until on restaurant bucket only", () => {
    expect(sql).toContain("where bucket_hash = v_restaurant_bucket and blocked_until > v_now");
  });

  it("increments failures on restaurant bucket only", () => {
    expect(sql).toContain("where bucket_hash = v_restaurant_bucket;");
  });

  it("still validates PIN format as 4 digits", () => {
    expect(sql).toContain("p_pin !~ '^[0-9]{4}$'");
  });

  it("still blocks after 5 failures in 15 minutes", () => {
    expect(sql).toContain("failures + 1 >= 5 then v_now + interval '15 minutes'");
  });
});
