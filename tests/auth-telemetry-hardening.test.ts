import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("drops obsolete RPCs without revoking missing signatures", () => {
  const migration = source("../supabase/migrations/20260823100000_fix_tenant_rpcs.sql");
  const drop = migration.indexOf("drop function if exists public.claim_crew_session(uuid, text, text, text, boolean, text)");
  expect(drop).toBeGreaterThan(-1);
  expect(migration).not.toContain("revoke all on function public.claim_crew_session(uuid, text, text, text, boolean, text)");
});

it("uses active database-backed tenant sessions for server tenant access", () => {
  const tenant = source("../src/lib/tenant-session.server.ts");
  expect(tenant).toContain("verifyActiveTenantSession");
  expect(tenant).toContain("restaurant_access_tokens");
  expect(tenant).toContain('"is_active", true');

  for (const path of [
    "../src/lib/restaurants.server.ts",
    "../src/lib/playback-events.server.ts",
    "../src/lib/operational-errors.server.ts",
  ])
    expect(source(path)).toContain("verifyActiveTenantSession");
});

it("binds telemetry to a token minted for claimed crew session", () => {
  const migration = source("../supabase/migrations/20260823105000_crew_session_tokens.sql");
  expect(migration).toMatch(/create table public\.crew_session_tokens/i);
  expect(migration).toMatch(/token_hash.*restaurant_id.*crew_session_id/is);
  expect(migration).toMatch(/create or replace function public\.claim_crew_session/i);
  expect(migration).toMatch(/session_token/i);

  const playback = source("../src/lib/playback-events.server.ts");
  expect(playback).toContain("crewSessionToken: z.string()");
  expect(playback).toContain("verifyCrewSessionToken");
  expect(playback).toContain("crewSessionId !== session.crewSessionId");
});

it("uses database RPCs for login and operational-error rate limits", () => {
  const migration = source("../supabase/migrations/20260823104000_login_rate_limit.sql");
  expect(migration).toMatch(/create table public\.login_rate_limits/i);
  expect(migration).toMatch(/restaurant_id.*client_key_hash/is);
  expect(migration).toMatch(/create function public\.check_tenant_login_rate_limit/i);
  expect(migration).toMatch(/create function public\.record_tenant_login_failure/i);

  const restaurants = source("../src/lib/restaurants.server.ts");
  expect(restaurants).toContain('rpc("check_tenant_login_rate_limit"');
  expect(restaurants).toContain('rpc("record_tenant_login_failure"');
  expect(restaurants).not.toContain("isTenantLoginRateLimited");
});

it("only writes bounded allowlisted operational errors with valid tenant session", () => {
  const errors = source("../src/lib/operational-errors.server.ts");
  expect(errors).toContain("OPERATIONS_ERROR_CODES");
  expect(errors).toContain("tenantToken: z.string()");
  expect(errors).toContain("verifyActiveTenantSession");
  expect(errors).toContain("crewSessionToken");
  expect(errors).toContain("replace(/[^\\x20-\\x7E]/g");
  expect(errors).toContain('rpc("check_operational_error_rate_limit"');
});

it("accepts stable sync report codes without accepting arbitrary report codes", () => {
  const errors = source("../src/lib/operational-errors.server.ts");
  expect(errors).toContain("SYNC_MANIFEST");
  expect(errors).toContain("SYNC_OFFLINE");
  expect(errors).toContain("SYNC_CACHE");
  expect(errors).toContain("SYNC_DOWNLOAD");
  expect(errors).toContain("OPERATIONS_REPORT_CODES.has(data.error.reportCode)");
});

it("limits session-storage tenant token lifetime and documents XSS exposure", () => {
  const tenant = source("../src/lib/tenant-session.server.ts");
  expect(tenant).toContain("const TOKEN_MAX_AGE_SECONDS = 60 * 60");
  expect(tenant).not.toContain("60 * 60 * 12");

  const identity = source("../src/lib/crew-session-identity.ts");
  expect(identity).toContain("sessionStorage");
  expect(identity).toContain("XSS");
});
