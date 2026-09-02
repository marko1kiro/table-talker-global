import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../supabase/migrations/20260902090000_dynamic_qr_tokens.sql",
  import.meta.url,
);
const remediationUrl = new URL(
  "../supabase/migrations/20260902110000_reject_null_qr_batch_tokens.sql",
  import.meta.url,
);
const source = () => readFileSync(migrationUrl, "utf8").toLowerCase();
const remediationSource = () => readFileSync(remediationUrl, "utf8").toLowerCase();

describe("M-01 dynamic QR database contract", () => {
  it("stores permanent export batches and per-table opaque tokens", () => {
    const sql = source();
    expect(sql).toContain("create table public.qr_export_batches");
    expect(sql).toContain("create table public.qr_table_tokens");
    expect(sql).toContain("domain_used");
    expect(sql).toContain("table_numbers integer[]");
    expect(sql).toContain("r2_key_xlsx");
    expect(sql).toContain("r2_key_csv");
    expect(sql).toContain("revoked_at");
    expect(sql).toMatch(/unique[\s\S]*\(token\)/);
    expect(sql).toMatch(
      /unique index[\s\S]*\(restaurant_id, table_number\)[\s\S]*where revoked_at is null/,
    );
  });

  it("commits a batch and selective token replacement in one transaction RPC", () => {
    const sql = source();
    expect(sql).toContain("commit_qr_export_batch");
    expect(sql).toMatch(/update public\.qr_table_tokens[\s\S]*set revoked_at = now\(\)/);
    expect(sql).toContain("insert into public.qr_export_batches");
    expect(sql).toContain("insert into public.qr_table_tokens");
    expect(sql).toContain("p_table_numbers");
    expect(sql).toContain("p_tokens");
  });

  it("rejects a null token array before creating an empty batch", () => {
    const sql = remediationSource();
    expect(sql).toContain("create or replace function public.commit_qr_export_batch");
    expect(sql).toContain("coalesce(cardinality(p_tokens), 0)");
  });

  it("resolves only active tokens and durably debounces by restaurant, table, and IP for 30 seconds", () => {
    const sql = source();
    expect(sql).toContain("resolve_and_enqueue_qr_scan");
    expect(sql).toContain("public.qr_scan_debounce");
    expect(sql).toMatch(/primary key \(restaurant_id, table_number, ip_hash\)/);
    expect(sql).toContain("interval '30 seconds'");
    expect(sql).toContain("insert into public.pending_qr_scans");
    expect(sql).toContain("t.revoked_at is null");
    expect(sql).toContain("r.is_active");
    expect(sql).toContain("r.esb_app_id");
  });

  it("keeps browser roles out while service_role alone can execute the RPCs", () => {
    const sql = source();
    expect(sql).toContain("enable row level security");
    expect(sql).toMatch(
      /revoke all on table public\.qr_export_batches from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on table public\.qr_table_tokens from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on table public\.qr_scan_debounce from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.commit_qr_export_batch[\s\S]*to service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.resolve_and_enqueue_qr_scan[\s\S]*to service_role/,
    );
  });

  it("provides computed batch history without deleting token or export history", () => {
    const sql = source();
    expect(sql).toContain("list_qr_export_batches");
    expect(sql).toContain("sebagian aktif");
    expect(sql).toContain("active");
    expect(sql).toContain("expired");
    expect(sql).not.toMatch(/delete from public\.qr_(table_tokens|export_batches)/);
  });
});
