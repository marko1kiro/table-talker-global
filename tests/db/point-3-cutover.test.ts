// Poin 3 TASKLET (Task 9): hard-cutover DB proof. The legacy account-less claim
// path must be gone after the full chain and every pre-cutover role session
// revoked, while the NEW account claim (crew_shift_claim) and the still-referenced
// tenant-login RPC survive. Built by stopping the chain one file BEFORE the
// cutover, seeding a legacy role session, then applying only the cutover -- so
// the DELETE + DROP are proven against real prior state, not an empty schema.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { applyMigrationsAfter, createTestDb, sha256Hex, stopAll, type TestDb } from "./harness";

const R1 = "11111111-1111-4111-8111-111111111111";
// The file immediately preceding 20260913130000_crew_legacy_cutover.sql.
const PRE_CUTOVER = "20260913120000_crew_shift_claim.sql";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("lime_p3_cutover", { stopAfter: PRE_CUTOVER });
  const c = await db.client();
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at, is_active)
     values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin-RESTO-1', 'sha256'), 'hex'), now(), true)`,
    [R1],
  );
  // A legacy role session + a live (non-expired) token bound to it -- exactly
  // what the cutover must revoke, and the session row the cutover must keep.
  const session = await c.query(
    `insert into public.crew_role_sessions (restaurant_id, role, display_name, checked_in_at)
     values ($1, 'kasir', 'Legacy Crew', now()) returning id`,
    [R1],
  );
  const sessionId = session.rows[0].id as string;
  await c.query(
    `insert into public.role_session_tokens (token_hash, restaurant_id, role_session_id, role, expires_at, code_version)
     values ($1, $2, $3, 'kasir', now() + interval '9 hours',
             (select code_version from public.restaurants where id = $2))`,
    [sha256Hex("legacy-token"), R1, sessionId],
  );
  // Pre-condition: the seed is real, and the legacy RPC + new RPC both exist
  // up to this point (right before the cutover).
  const pre = await c.query(
    `select
       (select count(*) from public.role_session_tokens)::int as tokens,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'claim_role_session')::int as legacy_rpc,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'crew_shift_claim')::int as new_rpc`,
  );
  expect(pre.rows[0]).toMatchObject({ tokens: 1, legacy_rpc: 1, new_rpc: 1 });
  // Now run ONLY the cutover migration.
  await applyMigrationsAfter(c, PRE_CUTOVER);
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

describe("Poin 3 crew legacy cutover", () => {
  test("claim_role_session is dropped for every overload", async () => {
    const c = await db.client();
    const r = await c.query(
      `select count(*)::int as n from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'claim_role_session'`,
    );
    expect(r.rows[0].n).toBe(0);
  });

  test("every pre-cutover role session token is revoked (DELETE really fires)", async () => {
    const c = await db.client();
    const r = await c.query(`select count(*)::int as n from public.role_session_tokens`);
    expect(r.rows[0].n).toBe(0);
  });

  test("crew_role_sessions table + rows survive (only tokens deleted, not the history)", async () => {
    const c = await db.client();
    const exists = await c.query(
      `select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'crew_role_sessions'`,
    );
    expect(exists.rowCount).toBe(1);
    const rows = await c.query(
      `select id, display_name from public.crew_role_sessions where restaurant_id = $1`,
      [R1],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].display_name).toBe("Legacy Crew");
  });

  test("the new account claim + still-referenced tenant login RPC are untouched", async () => {
    const c = await db.client();
    const r = await c.query(
      `select
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public' and p.proname='crew_shift_claim')::int as claim,
         (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public' and p.proname='login_to_restaurant_atomic')::int as login`,
    );
    // crew_shift_claim (new authority) and login_to_restaurant_atomic (not this
    // migration's call to prune) must both remain. getLiveAccess-style reads are
    // unaffected: restaurant_access_tokens / crew_role_sessions are intact.
    expect(r.rows[0]).toMatchObject({ claim: 1, login: 1 });
  });
});
