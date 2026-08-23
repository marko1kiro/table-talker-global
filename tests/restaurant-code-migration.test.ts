import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(new URL("../supabase/migrations/20260823110000_restaurant_code_credentials_additive.sql", import.meta.url), "utf8");

it("adds derived credential fields without SQL plaintext backfill", () => {
  expect(sql).toMatch(/add column code_hash text/i);
  expect(sql).toMatch(/add column code_encrypted text/i);
  expect(sql).toMatch(/add column code_version integer not null default 1/i);
  expect(sql).toMatch(/add column credential_rotated_at timestamptz/i);
  expect(sql).toMatch(/unique.*code_hash|code_hash.*unique/is);
  expect(sql).not.toMatch(/insert into public\.restaurants.*code/is);
  expect(sql).not.toMatch(/update public\.restaurants.*set.*code_hash/is);
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
