import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Second-layer QR scan bug: resolve_and_enqueue_qr_scan declares
// RETURNS TABLE(restaurant_id, table_number, esb_app_id, enqueued), so those
// OUT names become PL/pgSQL variables. The original ON CONFLICT used bare
// column names (restaurant_id, table_number, ip_hash), which Postgres then
// reported as ambiguous (SQLSTATE 42702) between the OUT variable and the
// table column. The remediation redefines the function with an unambiguous
// conflict target (ON CONSTRAINT qr_scan_debounce_pkey) in a NEW migration,
// leaving the original migration file untouched.
const migrationUrl = new URL(
  "../supabase/migrations/20260903090000_fix_qr_scan_conflict_target.sql",
  import.meta.url,
);
const source = () => readFileSync(migrationUrl, "utf8").toLowerCase();

describe("M-01 QR scan conflict-target remediation", () => {
  it("redefines resolve_and_enqueue_qr_scan with an unambiguous ON CONSTRAINT target", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.resolve_and_enqueue_qr_scan");
    expect(sql).toContain("on conflict on constraint qr_scan_debounce_pkey");
    expect(sql).not.toMatch(/on conflict \(restaurant_id/);
  });

  it("keeps the debounce, rate-limit, and durable-outbox behavior intact", () => {
    const sql = source();
    expect(sql).toContain("public.qr_scan_debounce");
    expect(sql).toContain("interval '30 seconds'");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toMatch(/accepted_scan_count\s*<\s*10/);
    expect(sql).toContain("insert into public.pending_qr_scans");
    expect(sql).toContain("t.revoked_at is null");
    expect(sql).toContain("r.is_active");
    expect(sql).toContain("return query select v_restaurant_id");
  });

  it("keeps service_role as the only executor of the RPC", () => {
    const sql = source();
    expect(sql).toMatch(
      /revoke all on function public\.resolve_and_enqueue_qr_scan[\s\S]*from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.resolve_and_enqueue_qr_scan[\s\S]*to service_role/,
    );
  });
});
