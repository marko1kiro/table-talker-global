import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260902040000_escort_intent_duplicate_guard.sql",
    import.meta.url,
  ),
  "utf8",
);

it("cleans up pre-existing duplicate/orphaned unresolved intents before the unique index is created", () => {
  const cleanupIndex = sql.indexOf("update public.table_escort_intents tei");
  const indexIndex = sql.indexOf(
    "create unique index table_escort_intents_one_active_per_table_idx",
  );
  expect(cleanupIndex).toBeGreaterThan(-1);
  expect(indexIndex).toBeGreaterThan(-1);
  expect(cleanupIndex).toBeLessThan(indexIndex);
  expect(sql).toMatch(/tos\.status = 'terisi'/);
  expect(sql).toMatch(/\(newer\.created_at, newer\.id\) > \(tei\.created_at, tei\.id\)/);
});

it("creates a partial unique index enforcing one active (unresolved) intent per table", () => {
  expect(sql).toMatch(
    /create unique index table_escort_intents_one_active_per_table_idx\s*\n\s*on public\.table_escort_intents \(restaurant_id, table_number\)\s*\n\s*where resolved = false/,
  );
});

it("re-creates create_escort_intent to return the existing intent id for a same-actor retry", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.create_escort_intent\(/i);
  expect(sql).toMatch(/for update/i);
  expect(sql).toMatch(/v_existing\.actor_session_id = v_session\.role_session_id/);
  expect(sql).toMatch(/return v_existing\.id/);
});

it("raises ALREADY_ESCORTED for a different actor, both on the pre-check and the unique_violation race path", () => {
  const occurrences = sql.match(/raise exception 'ALREADY_ESCORTED'/g) ?? [];
  expect(occurrences.length).toBeGreaterThanOrEqual(2);
  expect(sql).toMatch(/when unique_violation then/i);
});

it("still binds actor_session_id server-side from the verified satgas session and keeps the 10-minute expiry", () => {
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role = 'satgas'/i);
  expect(sql).toMatch(/now\(\) \+ interval '10 minutes'/);
});

it("preserves the grant/revoke pair for create_escort_intent", () => {
  expect(sql).toMatch(
    /revoke all on function public\.create_escort_intent\(uuid, integer, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.create_escort_intent\(uuid, integer, text\) to authenticated/i,
  );
});

it("resolves any pending escort intent for the table inside set_table_occupied_kasir's kosong->terisi transition", () => {
  const start = sql.indexOf("create or replace function public.set_table_occupied_kasir");
  const end = sql.indexOf("create or replace function public.set_table_empty_cleanup");
  const block = sql.slice(start, end);
  expect(block).toMatch(/if found then/i);
  expect(block).toMatch(
    /update public\.table_escort_intents\s*\n\s*set resolved = true\s*\n\s*where restaurant_id = p_restaurant_id\s*\n\s*and table_number = p_table_number\s*\n\s*and resolved = false/,
  );
  expect(block).toMatch(/perform realtime\.send\(/);
});

it("resolves any pending escort intent for the table inside record_qr_scan's kosong->terisi transition", () => {
  const start = sql.indexOf("create or replace function public.record_qr_scan");
  const end = sql.indexOf("drop function if exists public.get_table_occupancy_snapshot");
  const block = sql.slice(start, end);
  expect(block).toMatch(/if found then/i);
  expect(block).toMatch(/update public\.table_escort_intents\s*\n\s*set resolved = true/);
});

it("also resolves any stale pending escort intent inside set_table_empty_cleanup as defense-in-depth", () => {
  const start = sql.indexOf("create or replace function public.set_table_empty_cleanup");
  const end = sql.indexOf("create or replace function public.record_qr_scan");
  const block = sql.slice(start, end);
  expect(block).toMatch(/update public\.table_escort_intents\s*\n\s*set resolved = true/);
});

it("drops get_table_occupancy_snapshot before recreating it, since its RETURNS TABLE column list is changing", () => {
  const dropIndex = sql.indexOf(
    "drop function if exists public.get_table_occupancy_snapshot(uuid, text)",
  );
  const createIndex = sql.indexOf("create function public.get_table_occupancy_snapshot(");
  expect(dropIndex).toBeGreaterThan(-1);
  expect(createIndex).toBeGreaterThan(dropIndex);
});

it("extends get_table_occupancy_snapshot's return shape with escort_intent_id/expires_at/mine", () => {
  expect(sql).toMatch(
    /escort_intent_id uuid,\s*\n\s*escort_intent_expires_at timestamptz,\s*\n\s*escort_intent_mine boolean/,
  );
});

it("unions in kosong tables with an active escort intent, excluding any that are also terisi", () => {
  const start = sql.indexOf("create function public.get_table_occupancy_snapshot(");
  const block = sql.slice(start);
  expect(block).toMatch(/union all/i);
  expect(block).toMatch(/from public\.table_escort_intents tei/);
  expect(block).toMatch(/tei\.resolved = false/);
  expect(block).toMatch(/not exists \(/);
  expect(block).toMatch(/tos2\.status = 'terisi'/);
  expect(block).toMatch(/tei\.actor_session_id = v_session\.role_session_id/);
});

it("still excludes the 'ss' role and preserves the grant/revoke pair for get_table_occupancy_snapshot", () => {
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role <> 'ss'/i);
  expect(sql).toMatch(
    /revoke all on function public\.get_table_occupancy_snapshot\(uuid, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.get_table_occupancy_snapshot\(uuid, text\) to authenticated/i,
  );
});

it("never grants direct table access to public/anon/authenticated in this migration (RPC-only surface)", () => {
  expect(sql).not.toMatch(
    /grant\s+[\s\S]*?on\s+(?:table\s+)?public\.table_escort_intents\s+to\s+(anon|authenticated)/i,
  );
});
