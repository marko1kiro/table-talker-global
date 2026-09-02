import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = () =>
  readFileSync(
    new URL(
      "../supabase/migrations/20260902060000_qr_scan_durable_reconciliation.sql",
      import.meta.url,
    ),
    "utf8",
  );

const normalized = () => migration().replace(/\s+/g, " ").toLowerCase();

describe("M-03 QR scan durable reconciliation migration", () => {
  it("creates a private, idempotent pending scan outbox with retry metadata", () => {
    const sql = normalized();

    expect(sql).toMatch(/create table public\.pending_qr_scans/);
    expect(sql).toMatch(/scan_id uuid primary key/);
    expect(sql).toMatch(
      /restaurant_id uuid not null references public\.restaurants\s*\(id\) on delete cascade/,
    );
    expect(sql).toMatch(/table_number integer not null check \(table_number between 1 and 100\)/);
    expect(sql).toContain("attempt_count integer not null default 0");
    expect(sql).toContain("next_attempt_at timestamptz not null default now()");
    expect(sql).toContain("last_error text");
    expect(sql).toMatch(
      /status text not null default 'pending'.*check \(status in \('pending', 'processed', 'terminal'\)\)/,
    );
    expect(sql).toContain("alter table public.pending_qr_scans enable row level security");
    expect(sql).toMatch(
      /revoke all on table public\.pending_qr_scans from public, anon, authenticated, service_role/,
    );
  });

  it("enqueues only valid active-restaurant scans and rejects scan-id payload conflicts", () => {
    const sql = normalized();

    expect(sql).toMatch(
      /function public\.enqueue_qr_scan\(\s*p_scan_id uuid, p_restaurant_id uuid, p_table_number integer\s*\)/,
    );
    expect(sql).toMatch(/security definer set search_path = public/);
    expect(sql).toMatch(/where id = p_restaurant_id and is_active/);
    expect(sql).toContain("raise exception 'restaurant_not_found'");
    expect(sql).toContain("raise exception 'scan_id_conflict'");
    expect(sql).toMatch(
      /grant execute on function public\.enqueue_qr_scan\(uuid, uuid, integer\) to service_role/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.enqueue_qr_scan\(uuid, uuid, integer\) from public, anon, authenticated/,
    );
  });

  it("processes each outbox row transactionally through the hardened record_qr_scan RPC", () => {
    const sql = normalized();

    expect(sql).toMatch(/function public\.process_pending_qr_scan\(p_scan_id uuid\)/);
    expect(sql).toMatch(/from public\.pending_qr_scans where scan_id = p_scan_id for update/);
    expect(sql).toMatch(
      /perform public\.record_qr_scan\(v_scan\.restaurant_id, v_scan\.table_number\)/,
    );
    expect(sql).toMatch(/status = 'processed'.*processed_at = now\(\)/);
    expect(sql).toMatch(/status = 'terminal'.*terminal_at = now\(\)/);
    expect(sql).toMatch(/next_attempt_at = now\(\) \+ make_interval/);
    expect(sql).toMatch(
      /grant execute on function public\.process_pending_qr_scan\(uuid\) to service_role/,
    );
  });

  it("reconciles due rows safely and retains unresolved scans", () => {
    const sql = normalized();

    expect(sql).toMatch(
      /function public\.reconcile_pending_qr_scans\(p_limit integer default 100\)/,
    );
    expect(sql).toMatch(/where status = 'pending' and next_attempt_at <= now\(\)/);
    expect(sql).toContain("for update skip locked");
    expect(sql).toMatch(/perform public\.process_pending_qr_scan\(v_scan_id\)/);
    expect(sql).toMatch(
      /delete from public\.pending_qr_scans where status in \('processed', 'terminal'\)/,
    );
    expect(sql).not.toMatch(/delete from public\.pending_qr_scans where status = 'pending'/);
    expect(sql).toContain("interval '30 days'");
  });

  it("installs replay-safe automatic reconciliation and cleanup schedules", () => {
    const sql = normalized();

    expect(sql).toContain("create extension if not exists pg_cron");
    expect(sql).toContain("reconcile-pending-qr-scans-every-minute");
    expect(sql).toContain("cleanup-pending-qr-scans-daily");
    expect(sql).toMatch(
      /if not exists \(\s*select 1 from cron\.job where jobname = 'reconcile-pending-qr-scans-every-minute'\s*\)/,
    );
    expect(sql).toMatch(
      /exception when insufficient_privilege or undefined_file or undefined_function or invalid_schema_name or feature_not_supported then null/,
    );
  });
});
