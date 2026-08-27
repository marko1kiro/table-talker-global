import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("uses pg_catalog-first paths for every 007000 SECURITY DEFINER function", () => {
  const migration = readFileSync(
    "supabase/migrations/20260824007000_audit_database_remediation.sql",
    "utf8",
  );
  const functions = migration.match(/security definer\s+set search_path = [^\n]+/gi) ?? [];

  expect(functions.length).toBeGreaterThan(0);
  expect(
    functions.every((definition) =>
      /set search_path = pg_catalog, public(?:, realtime)?(?:\s+as\s+\$\$)?$/i.test(
        definition.trim(),
      ),
    ),
  ).toBe(true);
  expect(migration).not.toMatch(/set search_path = public(?:, realtime)?\b/i);
});

const root = new URL("../", import.meta.url);
const path = new URL("supabase/migrations/20260824007000_audit_database_remediation.sql", root);
const migration = existsSync(path) ? readFileSync(path, "utf8") : "";
const scheduler = migration.slice(migration.lastIndexOf("do $$"));
const remoteBroadcastPath = new URL(
  "supabase/migrations/20260813000000_super_admin_realtime_broadcast.sql",
  root,
);
const remoteBroadcastMigration = existsSync(remoteBroadcastPath)
  ? readFileSync(remoteBroadcastPath, "utf8")
  : "";
const claimMigrationPaths = [
  "supabase/migrations/20260812000000_super_admin_remote_audio.sql",
  "supabase/migrations/20260822100010_crew_sessions_restaurant_id.sql",
  "supabase/migrations/20260823100000_fix_tenant_rpcs.sql",
  "supabase/migrations/20260823105000_crew_session_tokens.sql",
  "supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql",
  "supabase/migrations/20260824000000_fix_crew_token_generation.sql",
];
const claimMigrationChain = claimMigrationPaths.map((migrationPath) =>
  readFileSync(new URL(migrationPath, root), "utf8"),
);

it("records owner retention scheduler mode in locked-down state", () => {
  expect(migration).toContain("create table public.owner_retention_scheduler_state");
  expect(migration).toContain(
    "scheduler_name text primary key check (scheduler_name = 'owner-retention-daily')",
  );
  expect(migration).toContain("mode text not null check (mode in ('pg_cron', 'edge_required'))");
  expect(migration).toContain("schedule text not null check (schedule = '17 3 * * *')");
  expect(migration).toContain("last_success_at timestamptz");
  expect(migration).toContain("last_result jsonb");
  expect(migration).toContain("updated_at timestamptz not null default now()");
  expect(migration).toContain("enable row level security");
  expect(migration).toContain(
    "revoke all on table public.owner_retention_scheduler_state from public, anon, authenticated",
  );
});

it("uses pg_cron only with exact retention job settings", () => {
  expect(migration).toContain("create extension if not exists pg_cron");
  expect(migration).toContain("perform cron.schedule(");
  expect(migration).toContain("'owner-retention-daily'");
  expect(migration).toContain("'17 3 * * *'");
  expect(migration).toContain("$cron$select public.run_owner_retention()$cron$");
  expect(migration).toContain("and schedule = '17 3 * * *'");
  expect(migration).toContain("and command = 'select public.run_owner_retention()'");
  expect(migration).toContain("'pg_cron'");
  expect(migration).toContain("'edge_required'");
});

it("validates exact cron job before recording pg_cron state", () => {
  const unschedule = scheduler.indexOf("perform cron.unschedule(job.jobid)");
  const schedule = scheduler.indexOf("perform cron.schedule(");
  const exactJob = scheduler.indexOf("and schedule = '17 3 * * *'");
  const pgCronState = scheduler.indexOf("'pg_cron'");

  expect(scheduler).toMatch(
    /for job in select jobid from cron\.job where jobname = 'owner-retention-daily' loop/i,
  );
  expect(scheduler).toContain("perform cron.unschedule(job.jobid)");
  expect(scheduler).toMatch(
    /perform cron\.schedule\([\s\S]*?\$cron\$select public\.run_owner_retention\(\)\$cron\$/i,
  );
  expect(scheduler).toMatch(
    /select count\(\*\) into exact_job_count[\s\S]*?jobname = 'owner-retention-daily'[\s\S]*?schedule = '17 3 \* \* \*'[\s\S]*?command = 'select public\.run_owner_retention\(\)'/i,
  );
  expect(scheduler).toContain("if owner_job_count <> 1 or exact_job_count <> 1 then");
  expect(unschedule).toBeGreaterThan(-1);
  expect(schedule).toBeGreaterThan(unschedule);
  expect(exactJob).toBeGreaterThan(schedule);
  expect(pgCronState).toBeGreaterThan(exactJob);
  expect(scheduler.slice(0, pgCronState)).toContain(
    "raise exception 'OWNER_RETENTION_SCHEDULER_INVALID'",
  );
});

it("runs retention and heartbeat atomically through service-only wrapper", () => {
  const wrapper =
    migration.match(
      /create or replace function public\.run_owner_retention\(\)([\s\S]*?)\n\$\$;/i,
    )?.[0] ?? "";
  const cleanup = wrapper.indexOf("public.cleanup_owner_retention()");
  const heartbeat = wrapper.indexOf("public.record_owner_retention_success(result)");

  expect(wrapper).toContain("returns jsonb");
  expect(wrapper).toContain("security definer");
  expect(wrapper).toContain("set search_path = pg_catalog, public");
  expect(cleanup).toBeGreaterThan(-1);
  expect(heartbeat).toBeGreaterThan(cleanup);
  expect(wrapper).toContain("return result");
  expect(migration).toContain(
    "revoke all on function public.run_owner_retention() from public, anon, authenticated",
  );
  expect(migration).toContain(
    "grant execute on function public.run_owner_retention() to service_role",
  );
});

it("falls back only for explicit pg_cron capability errors", () => {
  const exception = scheduler.indexOf("exception");
  const edgeRequired = scheduler.indexOf("'edge_required'", exception);
  const cronCatalog = scheduler.indexOf("if to_regclass('cron.job') is not null then", exception);
  const ownerJobCount = scheduler.indexOf("select count(*) into owner_job_count", exception);
  const schedulerInvalid = scheduler.indexOf(
    "raise exception 'OWNER_RETENTION_SCHEDULER_INVALID'",
    exception,
  );

  expect(scheduler).toMatch(
    /exception\s+when\s+insufficient_privilege\s+or\s+undefined_file\s+or\s+undefined_function\s+or\s+invalid_schema_name\s+or\s+feature_not_supported\s+or\s+object_not_in_prerequisite_state\s+then/i,
  );
  expect(scheduler).not.toMatch(/when others\s+then/i);
  expect(exception).toBeGreaterThan(-1);
  expect(edgeRequired).toBeGreaterThan(exception);
  expect(scheduler.slice(0, exception)).not.toContain("mode = 'edge_required'");
  expect(scheduler.slice(exception)).toMatch(
    /insert into public\.owner_retention_scheduler_state[\s\S]*?values \([\s\S]*?'edge_required'/i,
  );
  expect(cronCatalog).toBeGreaterThan(-1);
  expect(ownerJobCount).toBeGreaterThan(cronCatalog);
  expect(schedulerInvalid).toBeGreaterThan(ownerJobCount);
  expect(edgeRequired).toBeGreaterThan(schedulerInvalid);
  expect(scheduler.slice(exception, edgeRequired)).toMatch(
    /from cron\.job\s+where jobname = 'owner-retention-daily'[\s\S]*?if owner_job_count <> 0 then[\s\S]*?raise exception 'OWNER_RETENTION_SCHEDULER_INVALID'/i,
  );
});

it("provides bounded service-only scheduler success heartbeat", () => {
  const rpc =
    migration.match(
      /create or replace function public\.record_owner_retention_success\(p_result jsonb\)([\s\S]*?)\n\$\$;/i,
    )?.[0] ?? "";

  expect(rpc).toContain("returns void");
  expect(rpc).toContain("security definer");
  expect(rpc).toContain("set search_path = pg_catalog, public");
  expect(rpc).toMatch(/jsonb_typeof\(p_result\) <> 'object'/i);
  expect(rpc).toMatch(/pg_column_size\(p_result\) > 4096/i);
  expect(rpc).toContain("raise exception 'OWNER_RETENTION_SCHEDULER_STATE_MISSING'");
  expect(rpc).toMatch(
    /update public\.owner_retention_scheduler_state\s+set last_success_at = now\(\),\s+last_result = p_result,\s+updated_at = now\(\)\s+where scheduler_name = 'owner-retention-daily'/i,
  );
  expect(rpc).not.toMatch(/insert into/i);
  expect(rpc).not.toMatch(/mode\s*=/i);
  expect(rpc).not.toMatch(/schedule\s*=/i);
  expect(migration).toContain(
    "revoke all on function public.record_owner_retention_success(jsonb) from public, anon, authenticated",
  );
  expect(migration).toContain(
    "grant execute on function public.record_owner_retention_success(jsonb) to service_role",
  );
  expect(migration).not.toMatch(
    /grant\s+(?:all|select|insert|update|delete)[\s\S]*?on table public\.owner_retention_scheduler_state[\s\S]*?to service_role/i,
  );
});

it("normalizes pgcrypto into extensions and rejects incomplete installations", () => {
  const pgcrypto =
    migration.match(/create schema if not exists extensions;([\s\S]*?)\n\$\$;/i)?.[0] ?? "";

  expect(pgcrypto).toContain("create schema if not exists extensions");
  expect(pgcrypto).toMatch(
    /from pg_extension e\s+join pg_namespace n on n\.oid = e\.extnamespace\s+where e\.extname = 'pgcrypto'/i,
  );
  expect(pgcrypto).toMatch(/create extension pgcrypto with schema extensions/i);
  expect(pgcrypto).toMatch(/alter extension pgcrypto set schema extensions/i);
  expect(pgcrypto).toContain("to_regprocedure('extensions.digest(bytea,text)')");
  expect(pgcrypto).toContain("to_regprocedure('extensions.digest(text,text)')");
  expect(pgcrypto).toContain("to_regprocedure('extensions.gen_random_bytes(integer)')");
  expect(pgcrypto).toContain("raise exception 'PGCRYPTO_NAMESPACE_INVALID'");
  expect(pgcrypto).not.toMatch(/(?<![.\w])(?:digest|gen_random_bytes)\s*\(/i);
  expect(pgcrypto).not.toMatch(/when others\s+then/i);
  expect(pgcrypto).not.toMatch(/exception\s+when/i);
});

it("restores tenant-scoped stale crew cleanup before final session upsert", () => {
  const claim =
    migration.match(
      /create or replace function public\.claim_crew_session\(p_restaurant_id uuid, p_tenant_token text, p_display_name text, p_normalized_name text, p_device_description text, p_audio_ready boolean, p_visibility_state text\)([\s\S]*?)\n\$\$;/i,
    )?.[0] ?? "";
  const staleCleanup = claim.indexOf("update public.crew_sessions");
  const upsert = claim.indexOf("insert into public.crew_sessions");

  expect(claim).toContain(
    "returns jsonb language plpgsql security definer set search_path = pg_catalog, public",
  );
  expect(claim).toContain("if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if");
  expect(claim).toContain("extensions.digest(p_tenant_token, 'sha256')");
  expect(claim).toContain(
    "rat.expires_at > now() and r.is_active and rat.code_version = r.code_version",
  );
  expect(claim).toContain("v_token text := encode(extensions.gen_random_bytes(32), 'hex')");
  expect(claim).toMatch(
    /where restaurant_id = p_restaurant_id\s+and connection_state in \('connecting', 'connected'\)\s+and last_seen <= now\(\) - interval '30 seconds'/i,
  );
  expect(staleCleanup).toBeGreaterThan(-1);
  expect(upsert).toBeGreaterThan(staleCleanup);
  expect(claim).toContain(
    "delete from public.crew_session_tokens where crew_session_id = result.id",
  );
  expect(claim).toContain("extensions.digest(v_token, 'sha256')");
  const claimContract = migration.slice(
    migration.indexOf("create or replace function public.claim_crew_session"),
    migration.indexOf("create or replace function public.broadcast_remote_admin_invalidation"),
  );

  expect(claim).toMatch(
    /create or replace function public\.claim_crew_session\(p_restaurant_id uuid, p_tenant_token text, p_display_name text, p_normalized_name text, p_device_description text, p_audio_ready boolean, p_visibility_state text\)\s+returns jsonb/i,
  );
  expect(claimContract).toContain(
    "revoke all on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) from public, anon, service_role",
  );
  expect(claimContract).toContain(
    "grant execute on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) to authenticated",
  );
  expect(claimContract).not.toMatch(
    /grant execute on function public\.claim_crew_session\([^)]*\) to (?:public|anon|service_role)/i,
  );
});

it("drops every legacy claim_crew_session overload before restoring final signature", () => {
  const legacySignatures = [
    "text, text, text, boolean, text",
    "uuid, text, text, text, boolean, text",
  ];
  const finalCreate = migration.indexOf("create or replace function public.claim_crew_session");
  const cleanup = migration.slice(0, finalCreate);

  expect(claimMigrationChain[0]).toMatch(
    /create or replace function public\.claim_crew_session\(\s*p_display_name text,\s*p_normalized_name text,\s*p_device_description text,\s*p_audio_ready boolean,\s*p_visibility_state text/i,
  );
  expect(claimMigrationChain[1]).toMatch(
    /create or replace function public\.claim_crew_session\(\s*p_restaurant_id uuid,\s*p_display_name text,\s*p_normalized_name text,\s*p_device_description text,\s*p_audio_ready boolean,\s*p_visibility_state text/i,
  );
  expect(claimMigrationChain[2]).toContain(
    "drop function if exists public.claim_crew_session(uuid, text, text, text, boolean, text)",
  );
  expect(claimMigrationChain[3]).toContain(
    "drop function if exists public.claim_crew_session(uuid, text, text, text, text, boolean, text)",
  );
  expect(claimMigrationChain[4]).toContain(
    "drop function if exists public.claim_crew_session(uuid, text, text, text, text, boolean, text)",
  );

  for (const signature of legacySignatures) {
    const procedure = `public.claim_crew_session(${signature.replaceAll(", ", ",")})`;

    expect(cleanup).toContain(`to_regprocedure('${procedure}')`);
    expect(cleanup).toContain(
      `execute 'revoke all on function public.claim_crew_session(${signature}) from public, anon, authenticated, service_role'`,
    );
    expect(cleanup).toContain(`drop function if exists public.claim_crew_session(${signature})`);
    expect(cleanup).not.toMatch(
      new RegExp(
        `^revoke all on function public\\.claim_crew_session\\(${signature.replaceAll(/([()])/g, "\\$1").replaceAll(", ", ",\\s+")}\\) from`,
        "im",
      ),
    );
  }
});

it("moves remote-admin invalidations to owner dashboard without changing trigger contract", () => {
  const broadcast =
    migration.match(
      /create or replace function public\.broadcast_remote_admin_invalidation\(\)([\s\S]*?)\n\$\$;/i,
    )?.[0] ?? "";

  expect(broadcast).toContain("returns trigger");
  expect(broadcast).toContain("set search_path = pg_catalog, public, realtime");
  expect(broadcast).toContain("'owner-dashboard'");
  expect(broadcast).toContain("return new");
  expect(migration).toContain(
    "revoke all on function public.broadcast_remote_admin_invalidation() from public, anon, authenticated",
  );
  const crewTrigger =
    remoteBroadcastMigration.match(
      /create trigger crew_sessions_remote_admin_invalidation([\s\S]*?);/i,
    )?.[0] ?? "";
  const commandTrigger =
    remoteBroadcastMigration.match(
      /create trigger remote_commands_remote_admin_invalidation([\s\S]*?);/i,
    )?.[0] ?? "";

  expect(broadcast).toMatch(
    /create or replace function public\.broadcast_remote_admin_invalidation\(\)/i,
  );
  expect(crewTrigger).toMatch(
    /after insert or update on public\.crew_sessions\s+for each row execute function public\.broadcast_remote_admin_invalidation\(\)/i,
  );
  expect(commandTrigger).toMatch(
    /after insert or update on public\.remote_commands\s+for each row execute function public\.broadcast_remote_admin_invalidation\(\)/i,
  );
});

it("retains owner data using final timestamps and includes credential audit count", () => {
  const cleanup =
    migration.match(
      /create or replace function public\.cleanup_owner_retention\(\)([\s\S]*?)\n\$\$;/i,
    )?.[0] ?? "";

  expect(cleanup).toContain("where event_timestamp < now() - interval '30 days'");
  expect(cleanup).toContain("where occurred_at < now() - interval '30 days'");
  expect(cleanup).toContain("where created_at < now() - interval '30 days'");
  expect(cleanup).toContain("delete from public.restaurant_credential_audit");
  expect(cleanup).toContain("where created_at < now() - interval '90 days'");
  expect(cleanup).toContain("'credential_audit_deleted', credential_audit_deleted");
  expect(cleanup).not.toMatch(/playback_events\s+where created_at/i);
  expect(cleanup).not.toMatch(/operational_errors\s+where created_at/i);
  const cleanupContract = migration.slice(
    migration.indexOf("create or replace function public.cleanup_owner_retention"),
    migration.indexOf("create or replace function public.run_owner_retention"),
  );

  expect(cleanupContract).toContain(
    "revoke all on function public.cleanup_owner_retention() from public, anon, authenticated",
  );
  expect(cleanupContract).toContain(
    "grant execute on function public.cleanup_owner_retention() to service_role",
  );
  expect(cleanupContract).not.toMatch(
    /grant execute on function public\.cleanup_owner_retention\(\) to (?:public|anon|authenticated)/i,
  );
  expect(migration).toContain("result := public.cleanup_owner_retention()");
});
