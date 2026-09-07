import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATION_PATH = join(
  process.cwd(),
  "supabase/migrations/20260908010000_fix_purge_restaurant_test_data.sql",
);

describe("super_admin_purge_restaurant_test_data fix", () => {
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(MIGRATION_PATH, "utf8");
  });

  it("computes bucket hash for role_session_pin_attempts", () => {
    expect(sql).toContain("v_bucket := encode(extensions.digest('restaurant:'");
  });

  it("deletes from role_session_pin_attempts using bucket_hash", () => {
    expect(sql).toContain(
      "DELETE FROM public.role_session_pin_attempts WHERE bucket_hash = v_bucket",
    );
  });

  it("deletes manager_sessions", () => {
    expect(sql).toContain(
      "DELETE FROM public.manager_sessions WHERE restaurant_id = p_restaurant_id",
    );
  });

  it("deletes table_occupancy_revisions", () => {
    expect(sql).toContain(
      "DELETE FROM public.table_occupancy_revisions WHERE restaurant_id = p_restaurant_id",
    );
  });

  it("deletes restaurant_credential_audit", () => {
    expect(sql).toContain(
      "DELETE FROM public.restaurant_credential_audit WHERE restaurant_id = p_restaurant_id",
    );
  });

  it("does NOT delete audio_manifests (file/asset data)", () => {
    expect(sql).not.toContain("DELETE FROM public.audio_manifests");
  });

  it("does NOT delete qr_table_tokens (file/asset data)", () => {
    expect(sql).not.toContain("DELETE FROM public.qr_table_tokens");
  });

  it("does NOT delete qr_export_batches (file/asset data)", () => {
    expect(sql).not.toContain("DELETE FROM public.qr_export_batches");
  });

  it("still deletes all session/event/occupancy tables", () => {
    const tables = [
      "table_occupancy_state",
      "occupancy_transitions",
      "table_escort_intents",
      "qr_scan_events",
      "pending_qr_scans",
      "qr_scan_debounce",
      "role_session_tokens",
      "instruction_receipts",
      "manager_instructions",
      "crew_role_sessions",
      "crew_session_tokens",
      "crew_sessions",
      "playback_events",
      "operational_errors",
    ];
    for (const table of tables) {
      expect(sql).toContain(`DELETE FROM public.${table}`);
    }
  });
});
