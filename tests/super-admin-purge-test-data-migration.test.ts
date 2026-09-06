import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL("../supabase/migrations/20260907130000_super_admin_purge_test_data.sql", import.meta.url),
  "utf8",
);

describe("super admin purge test data migration", () => {
  it("creates super_admin_purge_restaurant_test_data function", () => {
    expect(sql).toContain(
      "create or replace function public.super_admin_purge_restaurant_test_data",
    );
  });
  it("deletes from all transient tables", () => {
    expect(sql).toContain("delete from public.table_occupancy_state");
    expect(sql).toContain("delete from public.occupancy_transitions");
    expect(sql).toContain("delete from public.table_escort_intents");
    expect(sql).toContain("delete from public.qr_scan_events");
    expect(sql).toContain("delete from public.pending_qr_scans");
    expect(sql).toContain("delete from public.qr_scan_debounce");
    expect(sql).toContain("delete from public.role_session_tokens");
    expect(sql).toContain("delete from public.role_session_pin_attempts");
    expect(sql).toContain("delete from public.crew_role_sessions");
    expect(sql).toContain("delete from public.crew_session_tokens");
    expect(sql).toContain("delete from public.crew_sessions");
    expect(sql).toContain("delete from public.playback_events");
    expect(sql).toContain("delete from public.crew_messages");
    expect(sql).toContain("delete from public.remote_commands");
    expect(sql).toContain("delete from public.operational_errors");
  });
  it("does not delete from master tables", () => {
    expect(sql).not.toContain("delete from public.restaurants");
    expect(sql).not.toContain("delete from public.manager_accounts");
    expect(sql).not.toContain("delete from public.audio_manifests");
    expect(sql).not.toContain("delete from public.qr_table_tokens");
    expect(sql).not.toContain("delete from public.qr_export_batches");
  });
  it("bumps table occupancy revision for realtime client refresh", () => {
    expect(sql).toContain("bump_table_occupancy_revision");
  });
});
