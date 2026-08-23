import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("drops obsolete RPCs without revoking missing signatures", () => {
  const migration = source("../supabase/migrations/20260823100000_fix_tenant_rpcs.sql");
  const drop = migration.indexOf(
    "drop function if exists public.claim_crew_session(uuid, text, text, text, boolean, text)",
  );
  expect(drop).toBeGreaterThan(-1);
  expect(migration).not.toContain(
    "revoke all on function public.claim_crew_session(uuid, text, text, text, boolean, text)",
  );
});

it("uses active database-backed tenant sessions for server tenant access", () => {
  const tenant = source("../src/lib/restaurant-session.server.ts");
  expect(tenant).toContain("verifyActiveTenantSession");
  expect(tenant).toContain("restaurant_access_tokens");
  expect(tenant).toContain('"is_active", true');
  expect(tenant).toContain("data.code_version !== data.restaurants.code_version");

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

it("drops exact prior claim signature before replacing its return type", () => {
  const migration = source("../supabase/migrations/20260823105000_crew_session_tokens.sql");
  const drop = migration.indexOf(
    "drop function if exists public.claim_crew_session(uuid, text, text, text, text, boolean, text)",
  );
  const create = migration.indexOf("create or replace function public.claim_crew_session");
  const grant = migration.indexOf(
    "grant execute on function public.claim_crew_session(uuid, text, text, text, text, boolean, text) to authenticated",
  );
  expect(drop).toBeGreaterThan(-1);
  expect(drop).toBeLessThan(create);
  expect(create).toBeLessThan(grant);
});

it("makes telemetry migration versions unique and backfills restaurant IDs before NOT NULL", () => {
  const migration = source("../supabase/migrations/20260823103500_secure_telemetry.sql");
  const backfill = migration.indexOf("update public.playback_events");
  const removeUnattributable = migration.indexOf(
    "delete from public.playback_events where restaurant_id is null",
  );
  const notNull = migration.indexOf("alter column restaurant_id set not null");
  expect(backfill).toBeGreaterThan(-1);
  expect(backfill).toBeLessThan(notNull);
  expect(removeUnattributable).toBeGreaterThan(backfill);
  expect(removeUnattributable).toBeLessThan(notNull);
});

it("uses database RPCs for login and operational-error rate limits", () => {
  const migration = source("../supabase/migrations/20260823104000_login_rate_limit.sql");
  expect(migration).toMatch(/create table public\.login_rate_limits/i);
  expect(migration).toMatch(/restaurant_id.*client_key_hash/is);
  expect(migration).toMatch(/create function public\.check_tenant_login_rate_limit/i);
  expect(migration).toMatch(/create function public\.record_tenant_login_failure/i);

  const restaurants = source("../src/lib/restaurants.server.ts");
  expect(restaurants).toContain("check_tenant_login_rate_limit");
  expect(restaurants).toContain('client.rpc("check_tenant_login_rate_limit"');
  expect(restaurants).toContain("clientLimit.error || ipLimit.error");
  expect(restaurants).toContain('rpc("clear_tenant_login_failures"');
  expect(restaurants).not.toContain("isTenantLoginRateLimited");
});

it("refreshes crew session token even when the session ID stays stable", () => {
  const index = source("../src/routes/index.tsx");
  expect(index).toContain("if (!identity) return;");
  expect(index).not.toContain("identity.crewSessionId === crewSessionId) return");
});

it("requires active version-bound crew tokens for every remote command RPC", () => {
  const migration = source(
    "../supabase/migrations/20260823131000_credential_revocation_contracts.sql",
  );
  expect(migration).toContain("drop function public.heartbeat_crew_session(boolean, text, text)");
  expect(migration).toContain("drop function public.claim_pending_remote_command()");
  expect(migration).toContain("drop function public.ack_remote_command(uuid, text, text)");
  for (const name of [
    "heartbeat_crew_session",
    "claim_pending_remote_command",
    "ack_remote_command",
  ])
    expect(migration).toMatch(
      new RegExp(`create function public\\.${name}\\([\\s\\S]*p_session_token text`, "i"),
    );
  expect(migration).toMatch(
    /crew_session_tokens[\s\S]*token_hash = encode\(extensions\.digest\(convert_to\(p_session_token, 'UTF8'\), 'sha256'\), 'hex'\)[\s\S]*expires_at > now\(\)[\s\S]*code_version = r\.code_version[\s\S]*r\.is_active/is,
  );
  expect(migration).toMatch(
    /grant execute on function public\.rotate_restaurant_credentials\(uuid, text, text, integer\), public\.deactivate_restaurant_credentials\(uuid, integer\) to service_role/i,
  );

  const hook = source("../src/hooks/use-remote-crew.ts");
  expect(hook).toContain("let crewSessionToken = registration.crewSessionToken");
  expect(hook).toContain("crewSessionToken = claimedSession.session_token");
  expect(hook).toMatch(
    /client\.rpc\("claim_pending_remote_command",\s*\{\s*p_session_token: crewSessionToken,?\s*\}\)/,
  );
});

it("uses pgcrypto digest portably in credential revocation RPCs", () => {
  const migration = source(
    "../supabase/migrations/20260823131000_credential_revocation_contracts.sql",
  );
  expect(migration).toMatch(/create extension if not exists pgcrypto with schema extensions/i);
  expect(migration).toMatch(
    /extensions\.digest\(convert_to\(p_session_token, 'UTF8'\), 'sha256'\)/i,
  );
});

it("rate limits every restaurant-code failure by opaque lookup and client hashes", () => {
  const migration = source(
    "../supabase/migrations/20260823131000_credential_revocation_contracts.sql",
  );
  expect(migration).toMatch(/create table public\.tenant_login_rate_limits/i);
  expect(migration).toMatch(/p_lookup_hash text, p_client_key_hash text/i);
  expect(migration).toMatch(
    /grant execute on function public\.check_tenant_login_rate_limit\(text, text\), public\.record_tenant_login_failure\(text, text\), public\.clear_tenant_login_failures\(text, text\) to service_role/i,
  );
  const restaurants = source("../src/lib/restaurants.server.ts");
  expect(restaurants).toContain('rpc("record_tenant_login_failure"');
  expect(restaurants).toContain("p_lookup_hash: codeHash");
  expect(restaurants).toContain(
    "if (!valid || !restaurant || lookupError || !restaurant.is_active)",
  );
});

it("rate limits restaurant-code failures by server-derived IP even when client keys rotate", () => {
  const migration = source("../supabase/migrations/20260823132000_server_ip_login_rate_limit.sql");
  expect(migration).toMatch(/tenant_login_rate_limits.*bucket_hash/is);
  expect(migration).toMatch(/p_lookup_hash text, p_bucket_hash text/i);
  expect(migration).toMatch(/rename column client_key_hash to bucket_hash/i);

  const restaurants = source("../src/lib/restaurants.server.ts");
  expect(restaurants).toContain('import { getRequest } from "@tanstack/react-start/server"');
  const requestIp = source("../src/lib/login-request-ip.server.ts");
  expect(requestIp).toContain('headers.get("x-vercel-forwarded-for")');
  expect(requestIp).toContain('headers.get("x-forwarded-for")?.split(",")[0]');
  expect(requestIp).toContain('headers.get("x-real-ip")');
  expect(restaurants).toContain("getLoginRateLimitBuckets(");
  expect(restaurants).toContain("p_bucket_hash: clientKeyHash");
  expect(restaurants).toContain("p_bucket_hash: ipKeyHash");
  expect(restaurants).toMatch(
    /Promise\.all\(\[\s*client\.rpc\("check_tenant_login_rate_limit"[\s\S]*ipKeyHash/s,
  );
  expect(restaurants).not.toMatch(/validator\(z\.object\([^)]*ip:/s);
});

it("checks global IP and client login buckets before restaurant lookup", () => {
  const migration = source("../supabase/migrations/20260823133000_global_login_rate_limit.sql");
  expect(migration).toMatch(/create table public\.tenant_global_login_rate_limits/i);
  expect(migration).toMatch(/primary key \(bucket_hash\)/i);
  expect(migration).toMatch(
    /create function public\.check_global_tenant_login_rate_limit\(p_bucket_hash text\)/i,
  );
  expect(migration).toMatch(/record_global_tenant_login_failure\(text\)/i);
  expect(migration).toMatch(/clear_global_tenant_login_failures\(text\)/i);

  const restaurants = source("../src/lib/restaurants.server.ts");
  const check = restaurants.indexOf('rpc("check_global_tenant_login_rate_limit"');
  const record = restaurants.indexOf('rpc("record_global_tenant_login_failure"');
  const lookup = restaurants.indexOf('.eq("code_hash", codeHash)');
  expect(check).toBeGreaterThan(-1);
  expect(check).toBeLessThan(lookup);
  expect(record).toBeGreaterThan(-1);
  expect(record).toBeLessThan(lookup);
  expect(restaurants).toContain('rpc("clear_global_tenant_login_failures"');
});

it("validates tenant-bound crew access server-side before local playback", () => {
  const access = source("../src/lib/playback-access.server.ts");
  expect(access).toContain("validateCrewAccess");
  expect(access).toContain("verifyActiveTenantSession");
  expect(access).toContain("verifyCrewSessionToken");
  expect(access).toContain("crewSessionId !== data.crewSessionId");

  const page = source("../src/routes/index.tsx");
  expect(page).toContain("validateCrewAccess");
  expect(page).toContain("await validateCrewAccess({");
  expect(page).toContain("invalidateCrewSession();");
  expect(page).toContain("Audio diblokir karena sesi resto tidak valid.");
});

it("gets localStorage client key outside dialog render", () => {
  const dialog = source("../src/components/CrewIdentityDialog.tsx");
  expect(dialog).toContain("function getClientKey()");
  expect(dialog).not.toContain('const clientKey = typeof window === "undefined"');
  expect(dialog).toContain("const clientKey = getClientKey();");
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

it("uses opaque random tenant tokens and documents XSS exposure", () => {
  const tenant = source("../src/lib/restaurant-session.server.ts");
  expect(tenant).toContain("randomBytes(32)");
  expect(tenant).toContain('toString("base64url")');
  expect(tenant).not.toContain("createHmac");

  const identity = source("../src/lib/crew-session-identity.ts");
  expect(identity).toContain("sessionStorage");
  expect(identity).toContain("XSS");
});
