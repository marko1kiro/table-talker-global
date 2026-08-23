import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationPath = new URL(
  "../supabase/migrations/20260823100000_fix_tenant_rpcs.sql",
  import.meta.url,
);

function migration() {
  return readFileSync(migrationPath, "utf8");
}

it("derives remote command tenant from target crew session", () => {
  const source = migration();
  expect(source).toMatch(/create function public\.create_remote_command\([\s\S]*?select cs\.id, cs\.restaurant_id[\s\S]*?from public\.crew_sessions cs/i);
  expect(source).toMatch(/insert into public\.remote_commands[\s\S]*?restaurant_id/i);
});

it("derives crew message tenant without a caller restaurant parameter", () => {
  const source = migration();
  expect(source).toMatch(/create function public\.create_crew_message\(\s*p_target_session_id uuid,\s*p_message text,\s*p_expires_in_seconds bigint default 5\s*\)/i);
  expect(source).not.toMatch(/create function public\.create_crew_message\([\s\S]*?p_restaurant_id/i);
  expect(source).toMatch(/insert into public\.crew_messages[\s\S]*?select cs\.id, cs\.restaurant_id[\s\S]*?from public\.crew_sessions cs/i);
});

it("scopes stale crew cleanup to requested restaurant", () => {
  expect(migration()).toMatch(/where restaurant_id = p_restaurant_id[\s\S]*?and connection_state in \('connecting', 'connected'\)/i);
});

it("enforces online normalized-name uniqueness per restaurant", () => {
  const source = migration();
  expect(source).toMatch(/create unique index[\s\S]*?on public\.crew_sessions \(restaurant_id, normalized_name\)[\s\S]*?where connection_state in \('connecting', 'connected'\)/i);
});

it("drops obsolete overloaded RPCs without revoking absent signatures", () => {
  const source = migration();
  expect(source).toMatch(/drop function if exists public\.create_crew_message\(uuid, text, uuid, bigint\)/i);
  expect(source).not.toMatch(/revoke all on function public\.create_crew_message\(uuid, text, bigint\) from public, anon, authenticated, service_role/i);
  expect(source).not.toMatch(/revoke all on function public\.create_remote_command\(uuid, text, text\) from public, anon, authenticated, service_role/i);
});

it("requires an unexpired hashed tenant token before a crew can claim a restaurant", () => {
  const source = migration();
  expect(source).toMatch(/create table public\.restaurant_access_tokens/i);
  expect(source).toMatch(/alter table public\.restaurant_access_tokens enable row level security/i);
  expect(source).toMatch(/revoke all on public\.restaurant_access_tokens from public, anon, authenticated/i);
  expect(source).toMatch(/create function public\.claim_crew_session\(\s*p_restaurant_id uuid,[\s\S]*?p_tenant_token text,/i);
  expect(source).toMatch(/from public\.restaurant_access_tokens[\s\S]*?restaurant_id = p_restaurant_id[\s\S]*?expires_at > now\(\)/i);
  expect(source).toMatch(/digest\(p_tenant_token, 'sha256'\)/i);
  expect(source).not.toMatch(/revoke all on function public\.claim_crew_session\(uuid, text, text, text, boolean, text\)/i);
});
