import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260831010000_table_occupancy_realtime_broadcast.sql",
    import.meta.url,
  ),
  "utf8",
);

function functionBlock(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextFunction = sql.indexOf("create or replace function public.", start + 1);
  return nextFunction === -1 ? sql.slice(start) : sql.slice(start, nextFunction);
}

it("re-creates set_table_occupied_kasir to broadcast invalidate only when the transition actually happens", () => {
  const block = functionBlock("set_table_occupied_kasir");
  expect(block).toMatch(/where public\.table_occupancy_state\.status = 'kosong'/i);
  expect(block).toMatch(
    /if found then\s+perform realtime\.send\(\s*jsonb_build_object\('table_number', p_table_number\),\s*'invalidate',\s*'table-occupancy:' \|\| p_restaurant_id::text,\s*false\s*\);\s*end if;/i,
  );
});

it("re-creates set_table_empty_cleanup to broadcast invalidate only when the transition actually happens", () => {
  const block = functionBlock("set_table_empty_cleanup");
  expect(block).toMatch(/where public\.table_occupancy_state\.status = 'terisi'/i);
  expect(block).toMatch(
    /if found then\s+perform realtime\.send\(\s*jsonb_build_object\('table_number', p_table_number\),\s*'invalidate',\s*'table-occupancy:' \|\| p_restaurant_id::text,\s*false\s*\);\s*end if;/i,
  );
});

it("re-creates confirm_escort_intent to broadcast invalidate only after the ALREADY_OCCUPIED guard passes", () => {
  const block = functionBlock("confirm_escort_intent");
  expect(block).toMatch(/if not found then raise exception 'ALREADY_OCCUPIED'; end if;/i);
  // The broadcast must appear after the guard and before the intent is marked resolved.
  const guardIdx = block.search(/if not found then raise exception 'ALREADY_OCCUPIED'; end if;/i);
  const broadcastIdx = block.search(/perform realtime\.send\(/i);
  const resolvedIdx = block.search(/update public\.table_escort_intents set resolved = true/i);
  expect(broadcastIdx).toBeGreaterThan(guardIdx);
  expect(resolvedIdx).toBeGreaterThan(broadcastIdx);
  expect(block).toMatch(
    /'invalidate',\s*'table-occupancy:' \|\| v_intent\.restaurant_id::text,\s*false/i,
  );
});

it("re-creates record_qr_scan to broadcast invalidate only when the transition actually happens, still service-role-only", () => {
  const block = functionBlock("record_qr_scan");
  expect(block).toMatch(/insert into public\.qr_scan_events/i);
  expect(block).toMatch(/where public\.table_occupancy_state\.status = 'kosong'/i);
  expect(block).toMatch(
    /if found then\s+perform realtime\.send\(\s*jsonb_build_object\('table_number', p_table_number\),\s*'invalidate',\s*'table-occupancy:' \|\| p_restaurant_id::text,\s*false\s*\);\s*end if;/i,
  );
  // This migration must not re-grant record_qr_scan to authenticated -- it
  // stays service-role-only, unchanged from the original migration.
  expect(block).not.toMatch(
    /grant execute on function public\.record_qr_scan\([^)]*\) to authenticated/i,
  );
});

it("adds a daily cleanup for role_session_tokens matching the sibling retention convention", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.cleanup_role_session_tokens\(\)/i);
  expect(sql).toMatch(
    /delete from public\.role_session_tokens where expires_at < now\(\) - interval '1 day'/i,
  );
  expect(sql).toMatch(
    /revoke all on function public\.cleanup_role_session_tokens\(\) from public, anon, authenticated/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.cleanup_role_session_tokens\(\) to service_role/i,
  );
  expect(sql).toMatch(/cron\.schedule\(\s*'cleanup-role-session-tokens-daily'/i);
});

it("never grants direct table access to public/anon/authenticated in this migration", () => {
  expect(sql).not.toMatch(/grant\s+[\s\S]*?to\s+(anon|authenticated)/i);
});
