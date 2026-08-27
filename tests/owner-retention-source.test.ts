import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root), "utf8");

it("provides automatic thirty-day owner retention", () => {
  const migration = file("supabase/migrations/20260824005000_owner_retention.sql");
  expect(migration).toContain("cleanup_owner_retention");
  expect(migration.match(/interval '30 days'/g)).toHaveLength(3);
  expect(migration).toContain("playback_events");
  expect(migration).toContain("operational_errors");
  expect(migration).toContain("owner_broadcasts");
  expect(migration).toContain("owner-retention-daily");
  expect(migration).toContain("$cron$select public.cleanup_owner_retention()$cron$");
  expect(migration).not.toContain("run_owner_retention");
  expect(existsSync(new URL("supabase/functions/owner-retention/index.ts", root))).toBe(true);
});

it("uses run_owner_retention once through abort-aware adapter", () => {
  const handler = file("supabase/functions/owner-retention/handler.ts");
  const index = file("supabase/functions/owner-retention/index.ts");

  expect(handler).toContain("runOwnerRetention(controller.signal)");
  expect(handler).not.toContain("recordSuccess");
  expect(index).toContain('rpc("run_owner_retention")');
  expect(index).toContain(".abortSignal(signal)");
  expect(index).toContain("persistSession: false");
  expect(index).toContain("autoRefreshToken: false");
  expect(index).toContain("OWNER_RETENTION_CONFIGURATION_MISSING");
  expect(index.indexOf("OWNER_RETENTION_CONFIGURATION_MISSING")).toBeLessThan(
    index.indexOf("const client = createClient"),
  );
});

it("repairs scheduler verification and event-time retention after rollout", () => {
  const repair = file("supabase/migrations/20260824006000_owner_retention_verification.sql");
  expect(repair).toContain("event_timestamp");
  expect(repair).toContain("occurred_at");
  expect(repair).toContain("owner_broadcasts");
  expect(repair).toContain("cron.job");
  expect(repair).toContain("owner-retention-daily");
  expect(repair).toContain("and schedule = '17 3 * * *'");
  expect(repair).toContain("and command = 'select public.cleanup_owner_retention()'");
  expect(repair).not.toContain("OWNER_RETENTION_SCHEDULER_MISSING");
  expect(repair).toContain("cleanup_owner_retention");
});

it("skips absent cron catalog and accepts exactly one historical cron job", () => {
  const repair = file("supabase/migrations/20260824006000_owner_retention_verification.sql");
  const count = repair.indexOf("select count(*)");
  const exactCount = repair.indexOf("select count(*) into exact_job_count");
  const raise = repair.indexOf("raise exception 'OWNER_RETENTION_SCHEDULER_INVALID'");

  expect(repair).toMatch(/if\s+to_regclass\('cron\.job'\)\s+is not null\s+then/i);
  expect(repair).toMatch(/select count\(\*\) into owner_job_count/i);
  expect(repair).toMatch(
    /select count\(\*\) into exact_job_count[\s\S]*?jobname = 'owner-retention-daily'[\s\S]*?schedule = '17 3 \* \* \*'[\s\S]*?command = 'select public\.cleanup_owner_retention\(\)'/i,
  );
  expect(repair).toContain("if owner_job_count <> 1 or exact_job_count <> 1 then");
  expect(count).toBeGreaterThan(-1);
  expect(exactCount).toBeGreaterThan(count);
  expect(raise).toBeGreaterThan(exactCount);
  expect(repair).not.toMatch(/exception\s+when/i);
});

it("keeps retention off browser routes", () => {
  for (const path of [
    "src/routes/super-admin/index.tsx",
    "src/routes/super-admin/history.tsx",
    "src/routes/super-admin/error-log.tsx",
  ]) {
    expect(file(path)).not.toContain("cleanup_owner_retention");
  }
});

it("documents owner retention scheduler modes without remote-command fallback conflation", () => {
  const readme = file("README.md");
  const runbook = file("docs/supabase-super-admin-remote-audio.md");
  const remediation = file("supabase/migrations/20260824007000_audit_database_remediation.sql");

  expect(readme).toContain("Owner retention");
  expect(runbook).toContain("pg_cron");
  expect(runbook).toContain("edge_required");
  expect(runbook).toContain("17 3 * * *");
  expect(runbook).toContain("select public.run_owner_retention()");
  expect(runbook).not.toContain("select public.cleanup_owner_retention()");
  expect(runbook).toContain("last_success_at");
  expect(runbook).toContain("Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>");
  expect(runbook).toContain("SUPABASE_URL");
  expect(runbook).toContain("SUPABASE_SERVICE_ROLE_KEY");
  expect(runbook).toContain("supabase functions deploy owner-retention");
  expect(runbook).not.toContain("YOUR_PROJECT_REF");
  expect(runbook).not.toContain("SUPABASE_ACCESS_TOKEN");
  expect(runbook.match(/^> Warning:/gm)).toHaveLength(1);
  expect(runbook).toMatch(/pgcrypto[\s\S]*DB5/i);
  expect(runbook).toMatch(/do not execute cleanup manually[\s\S]*non-disposable/i);
  expect(runbook).toMatch(/non-null `last_success_at`/);
  expect(runbook).toContain("Dashboard");
  expect(runbook).toContain("BLOCKED");
  expect(runbook).toMatch(
    /one authenticated POST scheduler[\s\S]*target[\s\S]*schedule[\s\S]*heartbeat/i,
  );
  expect(runbook).toMatch(/pg_cron[\s\S]*last_success_at[\s\S]*actual run/i);
  expect(remediation).toContain("$cron$select public.run_owner_retention()$cron$");
  expect(remediation).toContain("and command = 'select public.run_owner_retention()'");
});
