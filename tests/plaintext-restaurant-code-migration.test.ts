import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migration = () =>
  readFileSync(
    new URL("../supabase/migrations/20260831000000_plaintext_restaurant_code.sql", import.meta.url),
    "utf8",
  );

it("adds back a plain, strictly-uppercase, case-sensitive unique `code` column", () => {
  const sql = migration();
  expect(sql).toContain("alter table public.restaurants add column code text;");
  expect(sql).toContain("alter table public.restaurants alter column code set not null;");
  expect(sql).toContain("check (code ~ '^[A-Z0-9-]{6,32}$')");
  expect(sql).toContain("create unique index restaurants_code_key on public.restaurants (code);");
  // Must NOT be case-insensitive (no lower()) -- user explicitly kept strict UPPERCASE.
  expect(sql).not.toMatch(/restaurants_code_key on public\.restaurants \(lower\(code\)\)/);
});

it("backfills all 9 known restaurants by UUID with the user-supplied plain codes", () => {
  const sql = migration();
  const backfills: Array<[string, string]> = [
    ["b519a58f-1ecb-4131-9c69-4fa2a1bae18a", "BKSBAN"],
    ["08da5334-4244-4db7-9f63-74a0d675529c", "BKSMUT"],
    ["19b17c7c-8847-466e-a2f7-215787d361c6", "CKRTHA"],
    ["09828e0e-77f1-432c-81bc-3f5b82bf7ba3", "CKRTAR"],
    ["51a23c85-7e72-4395-ba88-710cfbc200e8", "CKRMAR"],
    ["10587808-9ab2-42b2-a190-e2205c25c2a2", "CKRCIK"],
    ["33916a05-7e95-42fa-bc3c-050bed2402c5", "CKRBUL"],
    ["98aa2a5c-560c-42e3-ace6-e8561cb40f62", "BKSGOL"],
    ["fa2dea0f-8c68-4c2f-bb72-17c34825c61e", "CKRBOS"],
  ];
  for (const [id, code] of backfills) {
    expect(sql).toContain(`update public.restaurants set code = '${code}' where id = '${id}'`);
  }
  expect(sql).toContain("raise exception 'UNPROVISIONED_RESTAURANT_PLAINTEXT_CODE'");
});

it("drops code_hash and code_encrypted entirely, per hapus total saja", () => {
  const sql = migration();
  expect(sql).toContain("alter table public.restaurants drop column if exists code_hash;");
  expect(sql).toContain("alter table public.restaurants drop column if exists code_encrypted;");
  expect(sql).toContain("drop index if exists public.restaurants_code_hash_key;");
});

it("rewrites login_to_restaurant_atomic to a plain-code lookup with no rate-limit params", () => {
  const sql = migration();
  expect(sql).toContain(
    "drop function if exists public.login_to_restaurant_atomic(text, text, text, text, timestamptz);",
  );
  expect(sql).toContain("create function public.login_to_restaurant_atomic(\n  p_code text,");
  expect(sql).not.toContain("p_lookup_hash");
  expect(sql).not.toContain("p_client_bucket_hash");
  expect(sql).not.toContain("p_ip_bucket_hash");
  expect(sql).toContain("where code = p_code and is_active");
  expect(sql).toContain(
    "grant execute on function public.login_to_restaurant_atomic(text, text, timestamptz) to service_role;",
  );
  expect(sql).not.toContain("tenant_login_rate_limits(lookup_hash");
});

it("rewrites provision/rotate credential RPCs to take a plain code parameter", () => {
  const sql = migration();
  expect(sql).toContain(
    "create function public.provision_restaurant_credentials(p_restaurant_id uuid, p_code text)",
  );
  expect(sql).toContain("where id = p_restaurant_id and code is null;");
  expect(sql).toContain(
    "create function public.rotate_restaurant_credentials(p_restaurant_id uuid, p_code text, p_next_code_version integer)",
  );
  expect(sql).toContain(
    "update public.restaurants set code = p_code, code_version = p_next_code_version, credential_rotated_at = now() where id = p_restaurant_id;",
  );
  // deactivate_restaurant_credentials never touched code_hash/code_encrypted,
  // so it must NOT be redefined (created/replaced) by this migration.
  expect(sql).not.toContain("function public.deactivate_restaurant_credentials");
});

it("removes the tenant/restaurant-code login rate-limit subsystem entirely, without touching owner-side rate limiting", () => {
  const sql = migration();
  expect(sql).toContain("drop table if exists public.tenant_login_rate_limits;");
  expect(sql).toContain("drop table if exists public.tenant_global_login_rate_limits;");
  for (const fn of [
    "check_tenant_login_rate_limit(text, text)",
    "record_tenant_login_failure(text, text)",
    "clear_tenant_login_failures(text, text)",
    "check_global_tenant_login_rate_limit(text)",
    "record_global_tenant_login_failure(text)",
    "clear_global_tenant_login_failures(text)",
    "cleanup_tenant_login_rate_limits()",
  ])
    expect(sql).toContain(`drop function if exists public.${fn};`);
  // Owner-side rate limiting tables/RPCs must never be dropped or redefined
  // by this migration -- only referenced in the explanatory comment and in
  // the still-untouched cleanup_owner_login_rate_limits() call.
  expect(sql).not.toContain("drop table if exists public.owner_login_rate_limit");
  expect(sql).not.toContain("drop function if exists public.reserve_owner_login_attempt");
  expect(sql).not.toContain("drop function if exists public.complete_owner_login_attempt");
  expect(sql).not.toContain("create or replace function public.reserve_owner_login_attempt");
  expect(sql).not.toContain("create or replace function public.complete_owner_login_attempt");
});

it("redefines run_owner_retention without the removed tenant rate-limit cleanup call", () => {
  const sql = migration();
  const fn = sql.slice(sql.indexOf("create or replace function public.run_owner_retention()"));
  expect(fn).toContain("cleanup_owner_login_rate_limits()");
  expect(fn).not.toContain("cleanup_tenant_login_rate_limits()");
  expect(fn).not.toContain("tenant_login_rate_limits");
});
