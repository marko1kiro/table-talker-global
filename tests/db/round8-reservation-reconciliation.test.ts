import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  connect,
  createTestDb,
  rawHexToken,
  rpc,
  rpcRows,
  scryptHash,
  sha256Hex,
  stopAll,
  type TestDb,
} from "./harness";

const R1 = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CLIENT_HASH = "c".repeat(64);
const IP_HASH = "d".repeat(64);

let db: TestDb;

async function reserve(c: Client, attemptKey: string): Promise<{ id?: string; error: string | null }> {
  const result = await rpcRows<{ reservation_id: string }>(c, "reserve_owner_login_attempt", {
    p_client_bucket_hash: CLIENT_HASH,
    p_ip_bucket_hash: IP_HASH,
    p_attempt_key: attemptKey,
  });
  return { id: result.rows[0]?.reservation_id, error: result.error };
}

beforeAll(async () => {
  db = await createTestDb("lime_r8_reservation_reconcile");
  const c = await db.client();
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin', 'sha256'), 'hex'), now())`,
    [R1],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, 'r8.manager', 'R8 Manager', $2, $3, 'aktif')`,
    [MANAGER_ID, R1, await scryptHash("pw")],
  );
}, 600_000);

afterEach(async () => {
  const c = await db.client();
  await c.query(`delete from public.manager_sessions`);
  await c.query(`delete from public.manager_pending_sessions`);
  await c.query(`delete from public.revoked_session_tombstones`);
  await c.query(`delete from public.owner_login_rate_limit_reservations`);
  await c.query(
    `update public.owner_login_rate_limit_buckets
     set failures = 0, blocked_until = null, sequence = 0,
         last_success_sequence = 0, window_started_at = now()`,
  );
});

afterAll(async () => {
  await db?.close();
  await stopAll();
});

describe("R8: reservation-bound manager handoff is authoritative and exactly-once", () => {
  test("confirm rejects a NULL reservation at the database boundary", async () => {
    const c = await db.client();
    const reservation = await reserve(c, "r8-null-confirm-reservation");
    expect(reservation.error).toBeNull();
    expect(reservation.id).toBeTruthy();

    const token = rawHexToken();
    await c.query(
      `insert into public.manager_pending_sessions
         (manager_id, restaurant_id, token_hash, reservation_id, expires_at)
       values ($1, $2, $3, $4, now() + interval '60 seconds')`,
      [MANAGER_ID, R1, sha256Hex(token), reservation.id],
    );

    const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: null,
    });
    expect(confirmed.error).toBeNull();
    expect(confirmed.data).toBe(false);

    const active = await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [
      sha256Hex(token),
    ]);
    expect(active.rowCount).toBe(0);
  });

  test("parallel reserve calls with one attempt key return the same reservation without errors", async () => {
    const clients = await Promise.all(
      Array.from({ length: 8 }, () => connect(db.connectionString)),
    );
    try {
      const results = await Promise.all(
        clients.map((client) => reserve(client, "r8-parallel-attempt-key")),
      );
      expect(results.every((result) => result.error === null)).toBe(true);
      const ids = results.map((result) => result.id).filter(Boolean);
      expect(ids).toHaveLength(8);
      expect(new Set(ids).size).toBe(1);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  test("a consumed attempt key reconciles to the same reservation after response loss", async () => {
    const c = await db.client();
    const attemptKey = "r8-consumed-attempt-reconciliation";
    const first = await reserve(c, attemptKey);
    expect(first).toMatchObject({ error: null });
    expect(first.id).toBeTruthy();

    const completed = await rpc<string>(c, "complete_owner_login_attempt", {
      p_reservation_id: first.id,
      p_success: true,
    });
    expect(completed).toMatchObject({ data: "SUCCEEDED", error: null });

    const retry = await reserve(c, attemptKey);
    expect(retry).toEqual({ id: first.id, error: null });
  });

  test("pending mint is idempotent for the same reservation and deterministic bearer", async () => {
    const c = await db.client();
    const reservation = await reserve(c, "r8-idempotent-pending-mint");
    expect(reservation.id).toBeTruthy();
    const token = rawHexToken();

    const first = await rpc<boolean>(c, "create_manager_session_pending", {
      p_manager_id: MANAGER_ID,
      p_reservation_id: reservation.id,
      p_token: token,
    });
    const retry = await rpc<boolean>(c, "create_manager_session_pending", {
      p_manager_id: MANAGER_ID,
      p_reservation_id: reservation.id,
      p_token: token,
    });

    expect(first).toMatchObject({ data: true, error: null });
    expect(retry).toMatchObject({ data: true, error: null });
    const rows = await c.query(
      `select manager_id::text, token_hash from public.manager_pending_sessions
       where reservation_id = $1`,
      [reservation.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toMatchObject({ manager_id: MANAGER_ID, token_hash: sha256Hex(token) });
  });

  test("reservation binding cannot be changed after pending mint", async () => {
    const c = await db.client();
    const firstReservation = await reserve(c, "r8-immutable-binding-first");
    const secondReservation = await reserve(c, "r8-immutable-binding-second");
    const token = rawHexToken();
    await c.query(
      `insert into public.manager_pending_sessions
         (manager_id, restaurant_id, token_hash, reservation_id, expires_at)
       values ($1, $2, $3, $4, now() + interval '60 seconds')`,
      [MANAGER_ID, R1, sha256Hex(token), firstReservation.id],
    );

    await expect(
      c.query(`update public.manager_pending_sessions set reservation_id = $1 where token_hash = $2`, [
        secondReservation.id,
        sha256Hex(token),
      ]),
    ).rejects.toThrow(/IMMUTABLE_RESERVATION_BINDING/);
  });
});
