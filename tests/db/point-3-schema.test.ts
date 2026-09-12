// Poin 3 TASKLET: executable DB proof for the crew account + pairing schema
// migration. Runs the FULL migration chain against a disposable vanilla
// Postgres (embedded locally, service container in CI via TEST_DATABASE_URL),
// then checks table/column existence, dropped dead objects, revoked grants,
// and the constraint semantics the edge layer will rely on. Production and
// staging databases are never contacted.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, scryptHash, stopAll, type TestDb } from "./harness";

const R1 = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const AUTH_UID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const HEX64 = "a".repeat(64);

let db: TestDb;

async function expectRejection(c: Client, sql: string, params?: unknown[]): Promise<void> {
  let failed = false;
  try {
    await c.query(sql, params);
  } catch {
    failed = true;
  }
  expect(failed).toBe(true);
}

beforeAll(async () => {
  db = await createTestDb("lime_p3_schema");
  const c = await db.client();
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin', 'sha256'), 'hex'), now())`,
    [R1],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, 'p3.manager', 'P3 Manager', $2, $3, 'aktif')`,
    [MANAGER_ID, R1, await scryptHash("pw")],
  );
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

describe("Poin 3 crew account schema", () => {
  test("new tables and carrier columns are selectable", async () => {
    const c = await db.client();
    await c.query(
      `select auth_uid, restaurant_id, email, full_name, status,
              active_device_hash, paired_by, paired_at
       from public.crew_accounts`,
    );
    await c.query(
      `select id, auth_uid, restaurant_id, email, full_name, otp_hash,
              otp_encrypted, attempts, status, expires_at, decided_by, decided_at
       from public.crew_pairing_requests`,
    );
    await c.query(`select auth_uid from public.crew_role_sessions`);
    await c.query(`select auth_user_id from public.manager_accounts`);
    await c.query(`select auth_user_id from public.area_manager_accounts`);
  });

  test("dead anonymous-signup objects are gone", async () => {
    const c = await db.client();
    const proc = await c.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('is_anonymous_signup_enabled', 'set_anonymous_signup_enabled')`,
    );
    expect(proc.rowCount).toBe(0);
    await expectRejection(c, `select * from public.system_config`);
  });

  test("no direct grants to anon/authenticated", async () => {
    const c = await db.client();
    for (const table of ["crew_accounts", "crew_pairing_requests"]) {
      for (const role of ["anon", "authenticated"]) {
        const r = await c.query(
          `select has_table_privilege($1, 'public.' || $2, 'select') as allowed`,
          [role, table],
        );
        expect(r.rows[0]?.allowed).toBe(false);
      }
    }
  });

  test("single pending pairing request per auth_uid", async () => {
    const c = await db.client();
    const pending = `insert into public.crew_pairing_requests
      (auth_uid, restaurant_id, email, full_name, otp_hash, otp_encrypted, expires_at)
      values ($1, $2, 'crew@example.com', 'Crew Satu', $3, $3, now() + interval '15 minutes')`;
    await c.query(pending, [AUTH_UID, R1, HEX64]);
    await expectRejection(c, pending, [AUTH_UID, R1, HEX64]);
    await c.query(
      `update public.crew_pairing_requests set status = 'approved' where auth_uid = $1`,
      [AUTH_UID],
    );
    await c.query(pending, [AUTH_UID, R1, HEX64]);
    await c.query(`delete from public.crew_pairing_requests`);
  });

  test("status, otp hash and attempts checks reject bad values", async () => {
    const c = await db.client();
    await expectRejection(
      c,
      `insert into public.crew_pairing_requests
         (auth_uid, restaurant_id, email, full_name, otp_hash, otp_encrypted, status, expires_at)
       values ($1, $2, 'crew@example.com', 'Crew Satu', $3, $3, 'maybe', now() + interval '15 minutes')`,
      [AUTH_UID, R1, HEX64],
    );
    await expectRejection(
      c,
      `insert into public.crew_pairing_requests
         (auth_uid, restaurant_id, email, full_name, otp_hash, otp_encrypted, expires_at)
       values ($1, $2, 'crew@example.com', 'Crew Satu', 'zz', $3, now() + interval '15 minutes')`,
      [AUTH_UID, R1, HEX64],
    );
    await expectRejection(
      c,
      `insert into public.crew_pairing_requests
         (auth_uid, restaurant_id, email, full_name, otp_hash, otp_encrypted, attempts, expires_at)
       values ($1, $2, 'crew@example.com', 'Crew Satu', $3, $3, 6, now() + interval '15 minutes')`,
      [AUTH_UID, R1, HEX64],
    );
  });

  test("crew_accounts happy path insert", async () => {
    const c = await db.client();
    await c.query(
      `insert into public.crew_accounts
         (auth_uid, restaurant_id, email, full_name, paired_by)
       values ($1, $2, 'crew@example.com', 'Crew Satu', $3)`,
      [AUTH_UID, R1, MANAGER_ID],
    );
    const r = await c.query(
      `select status, active_device_hash from public.crew_accounts where auth_uid = $1`,
      [AUTH_UID],
    );
    expect(r.rows[0]).toEqual({ status: "aktif", active_device_hash: null });
  });
});
