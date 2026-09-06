import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20260907120000_manager_daily_stats.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("manager daily stats migration", () => {
  it("creates occupancy_transitions table", () => {
    expect(sql).toContain("create table public.occupancy_transitions");
  });
  it("creates trigger on table_occupancy_state", () => {
    expect(sql).toContain(
      "create or replace function public.log_occupancy_transition",
    );
    expect(sql).toContain("create trigger trg_log_occupancy_transition");
  });
  it("creates get_manager_daily_stats RPC", () => {
    expect(sql).toContain(
      "create or replace function public.get_manager_daily_stats",
    );
  });
  it("creates retention cleanup function and cron", () => {
    expect(sql).toContain(
      "create or replace function public.cleanup_occupancy_transitions",
    );
    expect(sql).toContain("cleanup-occupancy-transitions-daily");
  });
  it("revokes public access on occupancy_transitions", () => {
    expect(sql).toContain(
      "revoke all on public.occupancy_transitions from public, anon, authenticated",
    );
  });
});
