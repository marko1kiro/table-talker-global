import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(
    new URL("../supabase/migrations/20260907150000_manager_instructions.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

describe("manager instructions migration", () => {
  it("creates manager_instructions table with correct columns", () => {
    const sql = source();
    expect(sql).toContain("create table public.manager_instructions");
    expect(sql).toContain("restaurant_id uuid not null");
    expect(sql).toContain("manager_id uuid not null");
    expect(sql).toContain("target_type text not null");
    expect(sql).toContain("check (target_type in ('all', 'individual'))");
    expect(sql).toContain("char_length(message) <= 200");
    expect(sql).toContain("expires_at timestamptz not null");
  });

  it("creates instruction_receipts table with correct columns", () => {
    const sql = source();
    expect(sql).toContain("create table public.instruction_receipts");
    expect(sql).toContain("instruction_id uuid not null references public.manager_instructions");
    expect(sql).toContain("role_session_id uuid not null");
    expect(sql).toContain("ack_at timestamptz");
    expect(sql).toContain("char_length(reply_text) <= 100");
    expect(sql).toContain("unique (instruction_id, role_session_id)");
  });

  it("defines send_manager_instruction RPC", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.send_manager_instruction(");
    expect(sql).toContain("p_manager_token text");
    expect(sql).toContain("p_target_type text");
    expect(sql).toContain("p_message text");
    expect(sql).toContain("returns uuid");
  });

  it("validates manager session in send RPC", () => {
    const sql = source();
    expect(sql).toContain("encode(extensions.digest(p_manager_token, 'sha256'), 'hex')");
    expect(sql).toContain("ma.status = 'aktif'");
    expect(sql).toContain("ms.expires_at > now()");
  });

  it("raises NO_ACTIVE_CREW when target all and no crew", () => {
    const sql = source();
    expect(sql).toContain("no_active_crew");
  });

  it("defines ack_instruction RPC", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.ack_instruction(");
    expect(sql).toContain("p_role_session_token text");
    expect(sql).toContain("p_instruction_id uuid");
  });

  it("ack is idempotent — skips already-acked", () => {
    const sql = source();
    expect(sql).toContain("ack_at is null");
  });

  it("defines get_pending_instructions RPC", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.get_pending_instructions(");
    expect(sql).toContain("expires_at > now()");
  });

  it("defines get_instruction_thread RPC", () => {
    const sql = source();
    expect(sql).toContain("create or replace function public.get_instruction_thread(");
    expect(sql).toContain("p_manager_token text");
  });

  it("creates broadcast triggers for instruction events", () => {
    const sql = source();
    expect(sql).toContain("broadcast_instruction_created");
    expect(sql).toContain("broadcast_instruction_acked");
    expect(sql).toContain("realtime.send(");
    expect(sql).toContain("'instruction'");
    expect(sql).toContain("'instruction_ack'");
  });

  it("grants RPCs to authenticated only", () => {
    const sql = source();
    expect(sql).toContain("grant execute on function public.send_manager_instruction");
    expect(sql).toContain("grant execute on function public.ack_instruction");
    expect(sql).toContain("grant execute on function public.get_pending_instructions");
    expect(sql).toContain("grant execute on function public.get_instruction_thread");
  });

  it("enables RLS on both tables", () => {
    const sql = source();
    expect(sql).toContain("alter table public.manager_instructions enable row level security");
    expect(sql).toContain("alter table public.instruction_receipts enable row level security");
  });

  it("schedules cleanup cron at 19:00 UTC (02:00 WIB)", () => {
    const sql = source();
    expect(sql).toContain("0 19 * * *");
    expect(sql).toContain("cleanup-expired-instructions");
  });

  it("adds new tables to purge RPC", () => {
    const sql = source();
    expect(sql).toContain("delete from public.instruction_receipts");
    expect(sql).toContain("delete from public.manager_instructions where restaurant_id");
  });
});
