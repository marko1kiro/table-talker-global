// Poin 6 S1 DB suite: the instruction-drop tombstone must remove every DB
// object the feature owned while replaying the full history, and must not
// touch any protected asset table.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, stopAll, type TestDb } from "./harness";

let db: TestDb;
let c: Client;

beforeAll(async () => {
  db = await createTestDb("lime_p6_instruction_drop");
  c = await db.client();
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

const FEATURE_FUNCTIONS = [
  "send_manager_instruction",
  "get_pending_instructions",
  "ack_instruction",
  "get_instruction_thread",
  "cleanup_expired_instructions",
  "get_manager_active_crew",
  "broadcast_instruction_created",
  "broadcast_instruction_acked",
];

describe("instruction drop tombstone", () => {
  test("every instruction-feature function is gone after replay", async () => {
    const rows = await c.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[])`,
      [FEATURE_FUNCTIONS],
    );
    expect(rows.rows).toEqual([]);
  });

  test("instruction tables are gone", async () => {
    const rows = await c.query(
      `select table_name from information_schema.tables
        where table_schema = 'public'
          and table_name in ('manager_instructions', 'instruction_receipts')`,
    );
    expect(rows.rows).toEqual([]);
  });

  test("instruction_receipts no longer in the supabase_realtime publication (when pg_cron/publication exist)", async () => {
    const pub = await c.query(
      `select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'instruction_receipts'`,
    );
    expect(pub.rows).toEqual([]);
  });

  test("cron cleanup job not registered (skipped when pg_cron unavailable in embedded harness)", async () => {
    const ext = await c.query(`select 1 from pg_extension where extname = 'pg_cron'`);
    if (ext.rows.length === 0) return;
    const jobs = await c.query(
      `select jobname from cron.job where jobname = 'cleanup-expired-instructions-daily'`,
    );
    expect(jobs.rows).toEqual([]);
  });

  test("protected asset tables all survive the replay", async () => {
    const rows = await c.query(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name = any($1::text[])`,
      [
        [
          "restaurants",
          "crew_accounts",
          "crew_role_sessions",
          "role_session_tokens",
          "manager_accounts",
          "area_manager_accounts",
          "crew_pairing_requests",
          "admin_audit_log",
          "table_occupancy_state",
          "table_occupancy_revisions",
        ],
      ],
    );
    expect(rows.rows[0].n).toBe(10);
  });
});
