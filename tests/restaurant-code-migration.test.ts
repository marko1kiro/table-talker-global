import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(new URL("../supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql", import.meta.url), "utf8");
const cleanupSql = readFileSync(
  new URL("../supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql", import.meta.url),
  "utf8",
);
const provisioningSql = readFileSync(
  new URL("../supabase/migrations/20260823111500_provision_restaurant_credentials.sql", import.meta.url),
  "utf8",
);
const crewTokenRepairSql = readFileSync(
  new URL("../supabase/migrations/20260824000000_fix_crew_token_generation.sql", import.meta.url),
  "utf8",
);

it("adds derived credential fields without SQL plaintext backfill", () => {
  expect(sql).toMatch(/add column code_hash text/i);
  expect(sql).toMatch(/add column code_encrypted text/i);
  expect(sql).toMatch(/add column code_version integer not null default 1/i);
  expect(sql).toMatch(/add column credential_rotated_at timestamptz/i);
  expect(sql).toMatch(/unique.*code_hash|code_hash.*unique/is);
  expect(sql).not.toMatch(/insert into public\.restaurants.*code/is);
  expect(sql).not.toMatch(/update public\.restaurants\s+set\s+code_hash\s*=\s*.*\bcode\b/is);
});

it("removes legacy credential columns only after derived credentials are present", () => {
  expect(cleanupSql).toMatch(/drop index if exists public\.restaurants_code_key/i);
  expect(cleanupSql).toMatch(/drop column if exists pin_hash/i);
  expect(cleanupSql).toMatch(/drop column code/i);
  expect(cleanupSql).toMatch(/alter column code_hash set not null/i);
  expect(cleanupSql).toMatch(/alter column code_encrypted set not null/i);
  expect(cleanupSql).toMatch(/alter column credential_rotated_at set not null/i);
  expect(cleanupSql).toMatch(/raise exception 'UNPROVISIONED_RESTAURANT_CREDENTIALS'/i);
});

it("uses a service-role-only RPC for provisioning after additive fields exist", () => {
  expect(provisioningSql).toMatch(/create function public\.provision_restaurant_credentials/i);
  expect(provisioningSql).toMatch(/where id = p_restaurant_id and code_hash is null and code_encrypted is null/i);
  expect(provisioningSql).toMatch(/grant execute.*to service_role/i);
});

it("binds opaque token rows and RPC authorization to current credential version", () => {
  expect(sql).toMatch(/restaurant_access_tokens[\s\S]*code_version integer[\s\S]*alter column code_version set not null/i);
  expect(sql).toMatch(/crew_session_tokens[\s\S]*code_version integer[\s\S]*alter column code_version set not null/i);
  expect(sql).toMatch(/create function public\.revoke_restaurant_credentials/i);
  expect(sql).toMatch(/delete from public\.restaurant_access_tokens/i);
  expect(sql).toMatch(/delete from public\.crew_session_tokens/i);
  expect(sql).toMatch(/connection_state = 'disconnected'/i);
  expect(sql).toMatch(/rat\.code_version = r\.code_version/i);
});

it("qualifies crew token generation for Supabase extension schema", () => {
  expect(crewTokenRepairSql).toMatch(/extensions\.gen_random_bytes\(32\)/i);
  expect(crewTokenRepairSql).toMatch(/create or replace function public\.claim_crew_session/i);
});
