// R6-D: forward-only replay evidence for the FULL Poin 2 migration chain.
// 1) Legacy seed VARIANTS (0/1/many/expired/unexpired sessions, multi-manager,
//    multi-tenant) replay through the entire chain on disposable Postgres and
//    must all land in the same R6-A/R6-B/R6-C end state: every legacy manager
//    session revoked at cutover, empty pending set, one-active invariant in
//    place, masters untouched, and the pending->active handshake working on
//    the migrated data.
// 2) SHA-256 checksum manifest of every Poin 2 migration (09010000..09080000,
//    including the rewritten 09060000 and the new 09070000/09080000) — the
//    reviewed/deployed content is frozen; any later edit breaks the build.
import { afterAll, describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import {
  createTestDb,
  rawHexToken,
  rpc,
  rpcRows,
  stopAll,
  type LegacySeed,
  type TestDb,
} from "./harness";

const POIN2_MIGRATIONS = [
  "20260909010000_staff_identity_schema.sql",
  "20260909020000_staff_access_rpcs.sql",
  "20260909030000_backfill_staff_id_registry.sql",
  "20260909040000_fix_realtime_bind_null_guard.sql",
  "20260909050000_staff_session_revocation_rpcs.sql",
  "20260909060000_manager_handoff_pending.sql",
  "20260909070000_session_revocation_verdicts.sql",
  "20260909080000_rate_limit_attempt_outcome.sql",
];

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const MANIFEST_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "point2-migration-checksums.json",
);

describe("R6-D: Poin 2 migration checksums are frozen", () => {
  test("manifest exists and matches every Poin 2 migration byte-for-byte", () => {
    const manifest: Record<string, string> = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
    expect(Object.keys(manifest).sort()).toEqual([...POIN2_MIGRATIONS].sort());
    for (const file of POIN2_MIGRATIONS) {
      const actual = createHash("sha256")
        .update(fs.readFileSync(path.join(MIGRATIONS_DIR, file)))
        .digest("hex");
      expect(actual, file).toBe(manifest[file]);
    }
  });
});

// --- legacy seed variants -----------------------------------------------------

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

type Variant = {
  name: string;
  seed: LegacySeed;
  /** (manager id, restaurant id, expires in hours; negative = already expired) */
  sessions: Array<[string, string, number]>;
};

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const M2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const M3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const VARIANT_A: Variant = {
  name: "empty",
  seed: async (c) => {
    await c.query(
      `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
       values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin-a', 'sha256'), 'hex'), now())`,
      [V1],
    );
    await c.query(
      `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
       values ($1, 'budi.santoso', 'Budi Santoso', $2, 'oldsalt:oldhash', 'aktif')`,
      [M1, V1],
    );
  },
  sessions: [],
};

const VARIANT_B: Variant = {
  name: "one-unexpired",
  seed: async (c) => {
    await VARIANT_A.seed(c);
    await seedSessions(c, VARIANT_B.sessions);
  },
  sessions: [[M1, V1, 12]],
};

const VARIANT_C: Variant = {
  name: "many-expired-multi-manager-tenant",
  seed: async (c) => {
    await c.query(
      `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at) values
         ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin-c1', 'sha256'), 'hex'), now()),
         ($2, 'RESTO-2', 'Resto Dua', encode(extensions.digest('pin-c2', 'sha256'), 'hex'), now())`,
      [V1, V2],
    );
    await c.query(
      `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status) values
         ($1, 'budi.santoso', 'Budi Santoso', $4, 'oldsalt:oldhash', 'aktif'),
         ($2, 'AgusKasir', 'Agus Kasir', $4, 'oldsalt:oldhash', 'aktif'),
         ($3, 'Citra.Kasir', 'Citra Kasir', $5, 'oldsalt:oldhash', 'aktif')`,
      [M1, M2, M3, V1, V2],
    );
    await seedSessions(c, VARIANT_C.sessions);
  },
  sessions: [
    [M1, V1, 12],
    [M1, V1, 6], // several rows for ONE manager (legacy allowed this)
    [M2, V1, -1], // already expired
    [M2, V1, 12],
  ],
};

/** Legacy sessions must be seeded BEFORE the Poin 2 migrations run (the
 * SEED_AFTER hook runs pre-09010000) so the cutover sees them. */
async function seedSessions(c: Client, sessions: Array<[string, string, number]>): Promise<void> {
  for (const [managerId, restaurantId, hours] of sessions) {
    await c.query(
      `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
       values ($1, $2, $3, now() + ($4 || ' hours')::interval)`,
      [managerId, restaurantId, sha256Hex(`${managerId}:${hours}`), String(hours)],
    );
  }
}

const dbs: TestDb[] = [];

async function replay(variant: Variant): Promise<TestDb> {
  const db = await createTestDb(`lime_r6_replay_${variant.name}`, { seedLegacy: variant.seed });
  dbs.push(db);
  return db;
}

async function assertCutoverEndState(c: Client) {
  // Every legacy session was revoked at cutover; pending set starts empty.
  expect(await count(c, "manager_sessions")).toBe(0);
  expect(await count(c, "manager_pending_sessions")).toBe(0);
  // The one-active invariant is in place from the first usable session on.
  const idx = await c.query(
    `select 1 from pg_indexes where schemaname = 'public' and indexname = 'manager_sessions_one_active_idx'`,
  );
  expect(idx.rowCount).toBe(1);
  // Legacy active-mint RPC is gone: no caller can mint a usable session.
  const legacy = await c.query(
    `select to_regprocedure('public.create_manager_session(uuid)') as reg`,
  );
  expect(legacy.rows[0]?.reg).toBeNull();
  // Chain-end schema evidence (R6-B tombstones + R6-C attempt outcomes).
  expect(await count(c, "revoked_session_tombstones")).toBe(0);
  const cols = await c.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'owner_login_rate_limit_reservations'`,
  );
  const names = cols.rows.map((r: { column_name: string }) => r.column_name as string);
  expect(names).toContain("attempt_key");
  expect(names).toContain("outcome");
}

async function count(c: Client, table: string): Promise<number> {
  const r = await c.query(`select count(*)::int as n from public.${table}`);
  return r.rows[0]?.n ?? 0;
}

/** The pending->active handshake works on the migrated legacy data. */
async function assertHandshakeWorks(c: Client, managerId: string, restaurantId: string) {
  const reserved = await rpcRows<{ reservation_id: string }>(c, "reserve_owner_login_attempt", {
    p_client_bucket_hash: sha256Hex(`replay:${managerId}:client`),
    p_ip_bucket_hash: sha256Hex(`replay:${managerId}:ip`),
    p_attempt_key: `replay-${managerId}-attempt`,
  });
  const reservationId = reserved.rows[0]?.reservation_id;
  expect(reservationId).toBeTruthy();
  const token = rawHexToken();
  const minted = await rpc<boolean>(c, "create_manager_session_pending", {
    p_manager_id: managerId,
    p_reservation_id: reservationId,
    p_token: token,
  });
  expect(minted.data).toBe(true);
  const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
    p_token: token,
    p_reservation_id: reservationId,
  });
  expect(confirmed.data).toBe(true);
  const rows = await c.query(
    `select count(*)::int as n from public.manager_sessions where manager_id = $1`,
    [managerId],
  );
  expect(rows.rows[0]?.n).toBe(1);
  void restaurantId;
}

describe("R6-D: legacy seed variants replay to the same forward-only end state", () => {
  afterAll(async () => {
    await Promise.all(dbs.map((d) => d.close().catch(() => undefined)));
    await stopAll();
  });

  test("variant A: no legacy sessions", async () => {
    const db = await replay(VARIANT_A);
    const c = await db.client();
    await assertCutoverEndState(c);
    await assertHandshakeWorks(c, M1, V1);
    expect(await count(c, "manager_accounts")).toBe(1);
    expect(await count(c, "restaurants")).toBe(1);
  }, 600_000);

  test("variant B: one unexpired legacy session is revoked", async () => {
    const db = await replay(VARIANT_B);
    const c = await db.client();
    await assertCutoverEndState(c);
    await assertHandshakeWorks(c, M1, V1);
  }, 600_000);

  test("variant C: many/expired sessions, multi-manager multi-tenant", async () => {
    const db = await replay(VARIANT_C);
    const c = await db.client();
    await assertCutoverEndState(c);
    await assertHandshakeWorks(c, M1, V1);
    await assertHandshakeWorks(c, M3, V2); // untouched tenant still works
    expect(await count(c, "manager_accounts")).toBe(3);
    expect(await count(c, "restaurants")).toBe(2);
  }, 600_000);
});
