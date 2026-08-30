import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260829000000_remove_remote_command_heartbeat.sql",
    import.meta.url,
  ),
  "utf8",
);

it("stops the pg_cron jobs targeting functions being dropped", () => {
  expect(sql).toMatch(/cron\.unschedule/i);
  expect(sql).toMatch(/expire-remote-commands-every-minute/);
  expect(sql).toMatch(/cleanup-remote-commands-daily/);
  expect(sql).toMatch(/cleanup-expired-crew-messages-every-minute/);
});

it("drops every remote-command / heartbeat / crew-message RPC", () => {
  expect(sql).toMatch(/drop function if exists public\.expire_remote_commands\(\)/i);
  expect(sql).toMatch(/drop function if exists public\.cleanup_remote_commands\(\)/i);
  expect(sql).toMatch(/drop function if exists public\.claim_pending_remote_command\(text\)/i);
  expect(sql).toMatch(
    /drop function if exists public\.ack_remote_command\(uuid, text, text, text\)/i,
  );
  expect(sql).toMatch(/drop function if exists public\.create_remote_command\(uuid, text, text\)/i);
  expect(sql).toMatch(
    /drop function if exists public\.heartbeat_crew_session\(boolean, text, text, text\)/i,
  );
  expect(sql).toMatch(
    /drop function if exists public\.create_crew_message\(uuid, text, uuid, bigint\)/i,
  );
  expect(sql).toMatch(/drop function if exists public\.cleanup_expired_crew_messages\(\)/i);
});

it("drops dead code and the entire owner-broadcast RPC surface", () => {
  expect(sql).toMatch(
    /drop function if exists public\.revoke_restaurant_credentials\(uuid, integer, text\)/i,
  );
  expect(sql).toMatch(
    /drop function if exists public\.create_owner_broadcast_delivery\(uuid, uuid, uuid, uuid, text\)/i,
  );
  expect(sql).toMatch(
    /drop function if exists public\.record_owner_broadcast_snapshot\(uuid, uuid, jsonb\)/i,
  );
  expect(sql).toMatch(/drop function if exists public\.finalize_owner_broadcast\(uuid, uuid\)/i);
  expect(sql).toMatch(
    /drop function if exists public\.create_or_get_owner_broadcast\(uuid, text, text, text, uuid, text\)/i,
  );
  expect(sql).toMatch(
    /drop function if exists public\.check_owner_broadcast_rate_limit\(text, integer, integer\)/i,
  );
});

it("drops all removal-target tables in FK-safe order", () => {
  const droppedTables = [
    "owner_broadcast_deliveries",
    "owner_broadcast_recipients",
    "owner_broadcast_targets",
    "owner_broadcast_rate_limits",
    "owner_broadcasts",
    "remote_commands",
    "crew_messages",
  ];
  const positions = droppedTables.map((table) => {
    const match = sql.match(new RegExp(`drop table if exists public\\.${table}\\b`, "i"));
    expect(match, `expected drop statement for ${table}`).not.toBeNull();
    return sql.indexOf(match![0]);
  });
  // owner_broadcast_deliveries (dependent) must be dropped before its
  // parents owner_broadcast_targets/owner_broadcasts.
  expect(positions[0]).toBeLessThan(sql.indexOf("drop table if exists public.owner_broadcasts"));
});

it("drops presence-only indexes on crew_sessions including the online-name key", () => {
  expect(sql).toMatch(/drop index if exists public\.crew_sessions_restaurant_presence_idx/i);
  expect(sql).toMatch(/drop index if exists public\.crew_sessions_presence_idx/i);
  expect(sql).toMatch(/drop index if exists public\.crew_sessions_online_name_key/i);
});

it("narrows crew_sessions to identity-only fields without dropping the table", () => {
  expect(sql).not.toMatch(/drop table if exists public\.crew_sessions\b/i);
  expect(sql).toMatch(/alter table public\.crew_sessions/i);
  for (const column of [
    "device_description",
    "audio_ready",
    "visibility_state",
    "connection_state",
    "last_seen",
    "offline_at",
  ]) {
    expect(sql).toMatch(new RegExp(`drop column if exists ${column}`, "i"));
  }
});

it("redefines claim_crew_session with a 4-param identity-only signature", () => {
  expect(sql).toMatch(
    /drop function if exists public\.claim_crew_session\(uuid, text, text, text, text, boolean, text\)/i,
  );
  expect(sql).toMatch(/create function public\.claim_crew_session\(/i);
  expect(sql).toMatch(/p_restaurant_id uuid/i);
  expect(sql).toMatch(/p_tenant_token text/i);
  expect(sql).toMatch(/p_display_name text/i);
  expect(sql).toMatch(/p_normalized_name text/i);
  expect(sql).not.toMatch(/p_device_description/i);
  expect(sql).not.toMatch(/p_audio_ready/i);
  expect(sql).not.toMatch(/p_visibility_state/i);
  // Preserves live code_version/is_active tenant validation, not the older
  // simpler check.
  expect(sql).toMatch(/rat\.code_version = r\.code_version/i);
  expect(sql).toMatch(/r\.is_active/i);
  expect(sql).toMatch(
    /grant execute on function public\.claim_crew_session\(uuid, text, text, text\) to authenticated/i,
  );
});

it("redefines owner_dashboard_snapshot without active_crew_devices", () => {
  expect(sql).toMatch(
    /create or replace function public\.owner_dashboard_snapshot\(p_since timestamptz\)/i,
  );
  expect(sql).not.toMatch(/'active_crew_devices'/i);
  expect(sql).toMatch(/'plays_today'/);
  expect(sql).toMatch(/'sync_failures'/);
  expect(sql).toMatch(/'unresolved_errors'/);
});

it("redefines owner_restaurant_list without online_devices", () => {
  expect(sql).toMatch(/create or replace function public\.owner_restaurant_list\(\)/i);
  expect(sql).not.toMatch(/'online_devices'/i);
  expect(sql).toMatch(/catalog_version/);
  expect(sql).toMatch(/latest_sync_failure/);
});

it("redefines owner_restaurant_detail without the presence-derived devices block", () => {
  expect(sql).toMatch(
    /create or replace function public\.owner_restaurant_detail\(p_restaurant_id uuid\)/i,
  );
  expect(sql).not.toMatch(/'devices'/i);
  expect(sql).toMatch(/'recent_playback'/);
  expect(sql).toMatch(/'recent_errors'/);
  expect(sql).toMatch(/'sync_history'/);
});

it("redefines credential rotation/deactivation RPCs without the crew_sessions presence write", () => {
  expect(sql).toMatch(/create or replace function public\.rotate_restaurant_credentials\(/i);
  expect(sql).toMatch(/create or replace function public\.deactivate_restaurant_credentials\(/i);
  expect(sql).not.toMatch(/connection_state = 'disconnected'/i);
  expect(sql).toMatch(/delete from public\.restaurant_access_tokens/i);
  expect(sql).toMatch(/delete from public\.crew_session_tokens/i);
});

it("redefines cleanup_owner_retention without the owner_broadcasts delete", () => {
  expect(sql).toMatch(/create or replace function public\.cleanup_owner_retention\(\)/i);
  expect(sql).not.toMatch(/delete from public\.owner_broadcasts/i);
  expect(sql).toMatch(/delete from public\.playback_events/i);
  expect(sql).toMatch(/delete from public\.operational_errors/i);
  expect(sql).toMatch(/delete from public\.restaurant_credential_audit/i);
});

it("does not touch unrelated tables/functions kept by the design", () => {
  const untouchedTables = [
    "audio_manifests",
    "restaurants\\b",
    "playback_events",
    "operational_errors",
    "owner_retention_scheduler_state",
    "restaurant_credential_audit",
    "crew_session_tokens",
    "restaurant_access_tokens",
    "tenant_login_rate_limits",
  ];
  for (const table of untouchedTables) {
    expect(sql).not.toMatch(new RegExp(`drop table if exists public\\.${table}`, "i"));
  }
  // The owner-dashboard realtime broadcast invalidation trigger/function is
  // an explicitly out-of-scope, kept, unrelated existing feature.
  expect(sql).not.toMatch(/broadcast_remote_admin_invalidation/i);
  expect(sql).not.toMatch(/drop.*owner-dashboard/i);
});
