import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL("../supabase/migrations/20260829020000_table_occupancy_rpcs.sql", import.meta.url),
  "utf8",
);

it("creates claim_role_session validating the tenant token and issuing a 9-hour role session token", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.claim_role_session\(/i);
  expect(sql).toMatch(/p_restaurant_id uuid/i);
  expect(sql).toMatch(/p_tenant_token text/i);
  expect(sql).toMatch(/p_role text/i);
  expect(sql).toMatch(/p_display_name text/i);
  expect(sql).toMatch(/p_checked_in_at timestamptz/i);
  expect(sql).toMatch(/security definer/i);
  expect(sql).toMatch(/set search_path = (?:pg_catalog, )?public/i);
  expect(sql).toMatch(/if auth\.uid\(\) is null then raise exception 'UNAUTHORIZED'/i);
  expect(sql).toMatch(
    /if p_role not in \('ss', 'kasir', 'satgas', 'clear_up'\) then raise exception 'INVALID_ROLE'/i,
  );
  expect(sql).toMatch(
    /from public\.restaurant_access_tokens rat\s*\n?\s*join public\.restaurants r on r\.id = rat\.restaurant_id/i,
  );
  expect(sql).toMatch(/rat\.expires_at > now\(\)/i);
  expect(sql).toMatch(/r\.is_active/i);
  expect(sql).toMatch(/raise exception 'INVALID_TENANT_SESSION'/i);
  expect(sql).toMatch(/char_length\(p_display_name\) not between 1 and 40/i);
  expect(sql).toMatch(/raise exception 'INVALID_NAME'/i);
  expect(sql).toMatch(/insert into public\.crew_role_sessions/i);
  expect(sql).toMatch(
    /insert into public\.role_session_tokens[\s\S]*?now\(\) \+ interval '9 hours'/i,
  );
  expect(sql).toMatch(
    /revoke all on function public\.claim_role_session\(uuid, text, text, text, timestamptz\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.claim_role_session\(uuid, text, text, text, timestamptz\) to authenticated/i,
  );
});

it("creates set_table_occupied_kasir as an idempotent, role-scoped kosong->terisi transition", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.set_table_occupied_kasir\(/i);
  expect(sql).toMatch(/p_restaurant_id uuid/i);
  expect(sql).toMatch(/p_table_number integer/i);
  expect(sql).toMatch(/p_session_token text/i);
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role = 'kasir'/i);
  expect(sql).toMatch(/raise exception 'INVALID_SESSION'/i);
  expect(sql).toMatch(
    /if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'/i,
  );
  expect(sql).toMatch(
    /insert into public\.table_occupancy_state[\s\S]*?values[\s\S]*?'terisi', now\(\), 'kasir'/i,
  );
  expect(sql).toMatch(
    /on conflict \(restaurant_id, table_number\) do update set[\s\S]*?status = 'terisi'[\s\S]*?occupied_source = 'kasir'/i,
  );
  expect(sql).toMatch(/where public\.table_occupancy_state\.status = 'kosong'/i);
  expect(sql).toMatch(
    /revoke all on function public\.set_table_occupied_kasir\(uuid, integer, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.set_table_occupied_kasir\(uuid, integer, text\) to authenticated/i,
  );
});

it("creates set_table_empty_cleanup as an idempotent, role-scoped terisi->kosong transition", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.set_table_empty_cleanup\(/i);
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role = 'clear_up'/i);
  expect(sql).toMatch(/insert into public\.table_occupancy_state[\s\S]*?values[\s\S]*?'kosong'/i);
  expect(sql).toMatch(
    /on conflict \(restaurant_id, table_number\) do update set[\s\S]*?status = 'kosong'[\s\S]*?occupied_at = null[\s\S]*?occupied_source = null/i,
  );
  expect(sql).toMatch(/where public\.table_occupancy_state\.status = 'terisi'/i);
  expect(sql).toMatch(
    /revoke all on function public\.set_table_empty_cleanup\(uuid, integer, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.set_table_empty_cleanup\(uuid, integer, text\) to authenticated/i,
  );
});

it("creates create_escort_intent binding actor_session_id server-side with a 30-minute expiry", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.create_escort_intent\(/i);
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role = 'satgas'/i);
  expect(sql).toMatch(
    /insert into public\.table_escort_intents[\s\S]*?now\(\) \+ interval '30 minutes'/i,
  );
  expect(sql).toMatch(
    /revoke all on function public\.create_escort_intent\(uuid, integer, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.create_escort_intent\(uuid, integer, text\) to authenticated/i,
  );
});

it("creates confirm_escort_intent enforcing actor ownership, post-expiry-only confirmation, and ALREADY_OCCUPIED guard", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.confirm_escort_intent\(/i);
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role = 'satgas'/i);
  expect(sql).toMatch(/actor_session_id = v_session\.role_session_id/i);
  expect(sql).toMatch(/expires_at <= now\(\)/i);
  expect(sql).toMatch(/resolved = false/i);
  expect(sql).toMatch(/raise exception 'INTENT_NOT_FOUND'/i);
  expect(sql).toMatch(/raise exception 'ALREADY_OCCUPIED'/i);
  expect(sql).toMatch(
    /insert into public\.table_occupancy_state[\s\S]*?'terisi', now\(\), 'satgas_escort'/i,
  );
  expect(sql).toMatch(/update public\.table_escort_intents set resolved = true/i);
  expect(sql).toMatch(
    /revoke all on function public\.confirm_escort_intent\(uuid, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.confirm_escort_intent\(uuid, text\) to authenticated/i,
  );
});

it("creates record_qr_scan as a service-role-only, always-logging, idempotent-state RPC", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.record_qr_scan\(/i);
  expect(sql).toMatch(
    /if p_table_number not between 1 and 100 then raise exception 'INVALID_TABLE_NUMBER'/i,
  );
  expect(sql).toMatch(/insert into public\.qr_scan_events/i);
  expect(sql).toMatch(
    /insert into public\.table_occupancy_state[\s\S]*?values[\s\S]*?'terisi', now\(\), 'qr_scan'/i,
  );
  expect(sql).toMatch(
    /on conflict \(restaurant_id, table_number\) do update set[\s\S]*?status = 'terisi'[\s\S]*?occupied_source = 'qr_scan'/i,
  );
  expect(sql).toMatch(/where public\.table_occupancy_state\.status = 'kosong'/i);
  // Zero grant to authenticated anywhere for this function -- service-role-only.
  const recordQrScanBlock = sql.slice(
    sql.indexOf("create or replace function public.record_qr_scan"),
  );
  expect(recordQrScanBlock).toMatch(
    /revoke all on function public\.record_qr_scan\(uuid, integer\) from public, anon, authenticated/i,
  );
  expect(recordQrScanBlock).not.toMatch(
    /grant execute on function public\.record_qr_scan\([^)]*\) to authenticated/i,
  );
  expect(recordQrScanBlock).toMatch(
    /grant execute on function public\.record_qr_scan\(uuid, integer\) to service_role/i,
  );
});

it("creates get_table_occupancy_snapshot returning all 100 rows via generate_series left join, excluding SS", () => {
  expect(sql).toMatch(/create (?:or replace )?function public\.get_table_occupancy_snapshot\(/i);
  expect(sql).toMatch(/from public\.role_session_tokens[\s\S]*?role <> 'ss'/i);
  expect(sql).toMatch(/generate_series\(1,\s*100\)/i);
  expect(sql).toMatch(/left join public\.table_occupancy_state/i);
  expect(sql).toMatch(
    /revoke all on function public\.get_table_occupancy_snapshot\(uuid, text\) from public, anon, service_role/i,
  );
  expect(sql).toMatch(
    /grant execute on function public\.get_table_occupancy_snapshot\(uuid, text\) to authenticated/i,
  );
});

it("never grants direct table access to public/anon/authenticated in this migration (RPC-only surface)", () => {
  const guardedTables = [
    "table_occupancy_state",
    "qr_scan_events",
    "table_escort_intents",
    "crew_role_sessions",
    "role_session_tokens",
    "restaurant_access_tokens",
  ];
  for (const table of guardedTables) {
    const grantToClientPattern = new RegExp(
      `grant\\s+[\\s\\S]*?on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+(anon|authenticated)`,
      "i",
    );
    expect(sql).not.toMatch(grantToClientPattern);
  }
});
