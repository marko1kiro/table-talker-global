import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  applyOwnerLoginAttempt,
  canCompleteOwnerLoginReservation,
  getOwnerLoginRateLimitBuckets,
  hashOwnerLoginRateLimitBucket,
  reserveOwnerLoginSequences,
  type OwnerLoginRateLimitBucket,
} from "../src/lib/owner-login-rate-limit.server";
import { getOwnerLoginClientKey } from "../src/lib/owner-login-client-key";

it("uses an HMAC-derived SHA-256 bucket hash without password material", () => {
  const first = hashOwnerLoginRateLimitBucket("client-key-123456", "rate-limit-secret");
  const second = hashOwnerLoginRateLimitBucket("client-key-123456", "rate-limit-secret");

  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(first).toBe(second);
  expect(hashOwnerLoginRateLimitBucket("client-key-123456", "other-secret")).not.toBe(first);
});

it("domain-separates client and IP bucket hashes", () => {
  const buckets = getOwnerLoginRateLimitBuckets(
    new Headers({ "x-real-ip": "203.0.113.8" }),
    "203.0.113.8",
    "rate-limit-secret",
  );

  expect(buckets.clientKeyHash).not.toBe(buckets.ipKeyHash);
});

it("keeps one in-memory client key when storage throws", () => {
  const brokenStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  } as unknown as Storage;

  expect(getOwnerLoginClientKey(brokenStorage)).toBe(getOwnerLoginClientKey(brokenStorage));
});

const bucket = (sequence = 0, failures = 0): OwnerLoginRateLimitBucket => ({
  sequence,
  lastSuccessSequence: 0,
  failures,
  windowStartedAt: 0,
  blockedUntil: null,
});

it("stale owner failure cannot restore failures after later successful completion", () => {
  const successful = applyOwnerLoginAttempt(bucket(2, 3), 2, true, 1);

  expect(applyOwnerLoginAttempt(successful, 1, false, 2)).toEqual(successful);
});

it("delayed owner success watermarks its reservation without clearing newer admission", () => {
  const afterSuccess = applyOwnerLoginAttempt(bucket(2, 3), 1, true, 1);
  const delayedFailure = applyOwnerLoginAttempt(afterSuccess, 1, false, 2);
  const newerFailure = applyOwnerLoginAttempt(delayedFailure, 2, false, 3);

  expect(afterSuccess).toMatchObject({ failures: 3, lastSuccessSequence: 1 });
  expect(delayedFailure).toEqual(afterSuccess);
  expect(newerFailure).toMatchObject({ failures: 4, lastSuccessSequence: 1 });
});

it("old success cannot clear newer failures", () => {
  const reserved = reserveOwnerLoginSequences(bucket(), bucket());
  const newerReserved = reserveOwnerLoginSequences(reserved.client, reserved.ip);
  const newerFailure = applyOwnerLoginAttempt(
    newerReserved.client,
    newerReserved.clientSequence,
    false,
    1,
  );

  expect(applyOwnerLoginAttempt(newerFailure, reserved.clientSequence, true, 2)).toMatchObject({
    failures: newerFailure.failures,
    lastSuccessSequence: reserved.clientSequence,
  });
});

it("fifth failure blocks bucket for fifteen minutes", () => {
  const result = applyOwnerLoginAttempt(bucket(5, 4), 5, false, 1_000);

  expect(result.failures).toBe(5);
  expect(result.blockedUntil).toBe(1_000 + 15 * 60 * 1_000);
});

it("failure completion records any reservation newer than last success", () => {
  expect(applyOwnerLoginAttempt(bucket(2), 1, false, 1)).toMatchObject({ failures: 1 });
  expect(applyOwnerLoginAttempt(bucket(1), 1, false, 1)).toMatchObject({ failures: 1 });
});

it("rejects expired and replayed reservation completion", () => {
  expect(canCompleteOwnerLoginReservation({ consumedAt: null, expiresAt: 10 }, 10)).toBe(false);
  expect(canCompleteOwnerLoginReservation({ consumedAt: 9, expiresAt: 11 }, 10)).toBe(false);
  expect(canCompleteOwnerLoginReservation({ consumedAt: null, expiresAt: 11 }, 10)).toBe(true);
});

it("keeps owner attempts inside service-only reservation RPCs", () => {
  const migration = readFileSync(
    "supabase/migrations/20260824008000_auth_rate_limit_remediation.sql",
    "utf8",
  );

  expect(migration).toContain("owner_login_rate_limit_buckets");
  expect(migration).toContain("owner_login_rate_limit_reservations");
  expect(migration).toContain("check (bucket_hash ~ '^[a-f0-9]{64}$')");
  expect(migration).toContain("sequence bigint not null default 0");
  expect(migration).toContain("last_success_sequence bigint not null default 0");
  expect(migration).toContain("last_success_sequence <= sequence");
  expect(migration).toContain(
    "expires_at timestamptz not null default (now() + interval '60 seconds')",
  );
  expect(migration).toContain("reserve_owner_login_attempt");
  expect(migration).toContain("complete_owner_login_attempt");
  expect(migration).toContain("order by bucket_hash for update");
  expect(migration).toContain("sequence = sequence + 1");
  expect(migration).toContain("v_reservation.client_sequence = sequence");
  expect(migration).toContain("v_reservation.ip_sequence = sequence");
  expect(migration).toContain("last_success_sequence = greatest(last_success_sequence");
  expect(migration).toContain(
    "where bucket_hash in (v_reservation.client_bucket_hash, v_reservation.ip_bucket_hash)",
  );
  expect(migration).toContain("v_reservation.client_sequence > last_success_sequence");
  expect(migration).toContain("v_reservation.ip_sequence > last_success_sequence");
  expect(migration).toContain("consumed_at is null and expires_at > v_now");
  expect(migration).toContain("select distinct bucket_hash");
  expect(migration).not.toContain("check (client_bucket_hash <> ip_bucket_hash)");
  expect(migration).toContain("cleanup_owner_login_rate_limits");
  expect(migration).toContain("owner_login_rate_limit_reservations_expires_at_idx");
  expect(migration).toContain("owner_login_rate_limit_reservations_consumed_at_idx");
  expect(migration).toContain("set search_path = pg_catalog, public");
  expect(migration).not.toContain("else blocked_until end,\n    where");
  const adapter = readFileSync("src/lib/owner-login-rate-limit.server.ts", "utf8");
  expect(adapter).toMatch(/reserveOwnerLoginAttempt[\s\S]*?catch\s*\{\s*return null;/);
  expect(adapter).toMatch(/completeOwnerLoginAttempt[\s\S]*?catch\s*\{\s*return false;/);
  expect(migration).toContain("security definer");
  expect(migration).toContain(
    "grant execute on function public.reserve_owner_login_attempt(text, text) to service_role",
  );
  expect(migration).not.toMatch(/SUPER_ADMIN_PASSWORD|password/i);
});

it("uses one atomic service-only restaurant login RPC with ordered rate rows", () => {
  const migration = readFileSync(
    "supabase/migrations/20260824008000_auth_rate_limit_remediation.sql",
    "utf8",
  );
  const restaurants = readFileSync("src/lib/restaurants.server.ts", "utf8");

  expect(migration).toContain("create or replace function public.login_to_restaurant_atomic");
  expect(migration).toContain("security definer set search_path = pg_catalog, public");
  expect(migration).toContain("p_lookup_hash text");
  expect(migration).toContain("p_client_bucket_hash text");
  expect(migration).toContain("p_ip_bucket_hash text");
  expect(migration).toContain("p_token_hash text");
  expect(migration).toContain("p_expires_at timestamptz");
  for (const parameter of [
    "p_lookup_hash",
    "p_client_bucket_hash",
    "p_ip_bucket_hash",
    "p_token_hash",
    "p_expires_at",
  ])
    expect(migration).toContain(`${parameter} is null`);
  expect(migration).toContain("raise exception 'INVALID_LOGIN_INPUT'");
  expect(migration).toContain("order by bucket_hash for update");
  expect(migration).toContain("order by lookup_hash, bucket_hash for update");
  expect(migration).toContain("interval '15 minutes'");
  expect(migration).toContain("interval '1 hour' + interval '5 minutes'");
  expect(migration).toContain("insert into public.restaurant_sessions");
  expect(migration).toContain("insert into public.restaurant_access_tokens");
  const loginFunction = migration.slice(
    migration.indexOf("create or replace function public.login_to_restaurant_atomic"),
    migration.indexOf("create or replace function public.run_owner_retention"),
  );
  expect(loginFunction).toContain("delete from public.tenant_global_login_rate_limits");
  expect(loginFunction).toContain("delete from public.tenant_login_rate_limits");
  expect(loginFunction).not.toMatch(/exception\s+when/i);
  expect(migration).toContain(
    "grant execute on function public.login_to_restaurant_atomic(text, text, text, text, timestamptz) to service_role",
  );
  expect(migration).toContain(
    "public.check_tenant_login_rate_limit(text, text), public.record_tenant_login_failure(text, text)",
  );
  expect(migration).toContain("from public, anon, authenticated, service_role");
  for (const signature of [
    "check_tenant_login_rate_limit(uuid, text)",
    "record_tenant_login_failure(uuid, text)",
    "clear_tenant_login_failures(uuid, text)",
    "check_tenant_login_rate_limit(text, text)",
    "record_tenant_login_failure(text, text)",
    "clear_tenant_login_failures(text, text)",
    "check_global_tenant_login_rate_limit(text)",
    "record_global_tenant_login_failure(text)",
    "clear_global_tenant_login_failures(text)",
  ])
    expect(migration).toContain(`drop function if exists public.${signature}`);
  expect(migration).toContain("cleanup_tenant_login_rate_limits");
  expect(restaurants).toContain('client.rpc("login_to_restaurant_atomic"');
  expect(restaurants).not.toContain('rpc("record_tenant_login_failure"');
  expect(restaurants).not.toContain('rpc("clear_global_tenant_login_failures"');
  expect(loginFunction.indexOf("order by bucket_hash for update")).toBeLessThan(
    loginFunction.indexOf("select * into v_restaurant"),
  );
});
