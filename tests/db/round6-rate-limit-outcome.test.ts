// R6-C RED: durable, exactly-once rate-limit reservation outcomes.
// - complete_owner_login_attempt returns a structured VERDICT (not boolean)
//   and records the outcome durably (succeeded/failed) via CAS;
// - reservations carry an idempotency attempt_key (same unconsumed key ->
//   same reservation; consumed/expired key -> null);
// - duplicate completion can never flip a decided outcome;
// - confirm_manager_session activates the pending session AND finalizes the
//   outcome in ONE atomic DB transaction.
// Baseline (boolean complete, no outcome column, no attempt key, 1-arg
// confirm): every test below fails.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, rpc, scryptHash, stopAll, type TestDb } from "./harness";
import { sha256Hex } from "node:crypto";

const R1 = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CLIENT_HASH = "a".repeat(64);
const IP_HASH = "b".repeat(64);

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("lime_r6_rate_limit");
  const c = await db.client();
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin', 'sha256'), 'hex'), now())`,
    [R1],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, 'budi.santoso', 'Budi Santoso', $2, $3, 'aktif')`,
    [MANAGER_ID, R1, await scryptHash("pw")],
  );
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

afterEach(async () => {
  const c = await db.client();
  await c.query(`delete from public.manager_sessions`);
  await c.query(`delete from public.manager_pending_sessions`);
  await c.query(`delete from public.owner_login_rate_limit_reservations`);
  await c.query(
    `update public.owner_login_rate_limit_buckets set failures = 0, blocked_until = null, sequence = 0, last_success_sequence = 0, window_started_at = now()`,
  );
});

async function reserve(c: Client, attemptKey?: string): Promise<string | null> {
  const { data, error } = await rpc<{ reservation_id: string }[]>(
    c,
    "reserve_owner_login_attempt",
    attemptKey === undefined
      ? { p_client_bucket_hash: CLIENT_HASH, p_ip_bucket_hash: IP_HASH }
      : { p_client_bucket_hash: CLIENT_HASH, p_ip_bucket_hash: IP_HASH, p_attempt_key: attemptKey },
  );
  if (error) return null;
  return data?.[0]?.reservation_id ?? null;
}

async function complete(
  c: Client,
  reservationId: string,
  success: boolean,
): Promise<{ data: unknown; error: string | null }> {
  return rpc(c, "complete_owner_login_attempt", {
    p_reservation_id: reservationId,
    p_success: success,
  });
}

describe("R6-C: reservation state machine is durable and exactly-once", () => {
  test("complete returns a verdict string and records the outcome", async () => {
    const c = await db.client();
    const id = await reserve(c);
    expect(id).toBeTruthy();
    const ok = await complete(c, id as string, true);
    expect(ok.error).toBeNull();
    expect(ok.data).toBe("SUCCEEDED");
    const row = await c.query(
      `select outcome, consumed_at from public.owner_login_rate_limit_reservations where id = $1`,
      [id],
    );
    expect(row.rows[0]?.outcome).toBe("succeeded");
    expect(row.rows[0]?.consumed_at).not.toBeNull();
  });

  test("failure completion records outcome=failed", async () => {
    const c = await db.client();
    const id = await reserve(c);
    const res = await complete(c, id as string, false);
    expect(res.data).toBe("FAILED");
    const row = await c.query(
      `select outcome from public.owner_login_rate_limit_reservations where id = $1`,
      [id],
    );
    expect(row.rows[0]?.outcome).toBe("failed");
  });

  test("duplicate completion never flips the decided outcome", async () => {
    const c = await db.client();
    const id = await reserve(c);
    expect((await complete(c, id as string, true)).data).toBe("SUCCEEDED");
    expect((await complete(c, id as string, false)).data).toBe("ALREADY_SUCCEEDED");
    expect((await complete(c, id as string, true)).data).toBe("ALREADY_SUCCEEDED");
    const row = await c.query(
      `select outcome from public.owner_login_rate_limit_reservations where id = $1`,
      [id],
    );
    expect(row.rows[0]?.outcome).toBe("succeeded");
  });

  test("concurrent duplicate completion: exactly one final outcome", async () => {
    const c = await db.client();
    const id = await reserve(c);
    const verdicts = await Promise.all([
      complete(c, id as string, true),
      complete(c, id as string, true),
    ]);
    const decided = verdicts.filter((v) => v.data === "SUCCEEDED");
    expect(decided).toHaveLength(1);
  });

  test("same attempt key re-reserves the SAME unconsumed reservation", async () => {
    const c = await db.client();
    const first = await reserve(c, "attempt-key-aaaaaaaaaaaa");
    const second = await reserve(c, "attempt-key-aaaaaaaaaaaa");
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  test("attempt key is dead after a final outcome (no reuse)", async () => {
    const c = await db.client();
    const id = await reserve(c, "attempt-key-bbbbbbbbbbbb");
    await complete(c, id as string, false);
    const reuse = await reserve(c, "attempt-key-bbbbbbbbbbbb");
    expect(reuse).toBeNull();
  });

  test("fresh keys still pass the SAME bucket enforcement (rotation is not a bypass)", async () => {
    const c = await db.client();
    // Burn 5 failures to trip the 15-minute block.
    for (let i = 0; i < 5; i++) {
      const id = await reserve(c, `attempt-key-fail-${i}aaaaaaaa`);
      expect(id).toBeTruthy();
      const res = await complete(c, id as string, false);
      expect(res.data).toBe("FAILED");
    }
    const blockedNewKey = await reserve(c, "attempt-key-fresh-bbbbbaaa");
    expect(blockedNewKey).toBeNull();
  });

  test("expired reservation with a used key cannot be re-reserved", async () => {
    const c = await db.client();
    const id = await reserve(c, "attempt-key-expired-aaaaaa");
    await c.query(`update public.owner_login_rate_limit_reservations set expires_at = now() - interval '1 second' where id = $1`, [id]);
    const reuse = await reserve(c, "attempt-key-expired-aaaaaa");
    expect(reuse).toBeNull();
  });

  test("confirm activates the pending session AND finalizes the outcome atomically", async () => {
    const c = await db.client();
    const token = (
      await rpc<string>(c, "create_manager_session_pending", { p_manager_id: MANAGER_ID })
    ).data as string;
    const id = await reserve(c, "attempt-key-confirm-aaaaaaa");
    expect(id).toBeTruthy();

    const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: id,
    });
    expect(confirmed.data).toBe(true);

    const session = await c.query(
      `select 1 from public.manager_sessions where token_hash = $1`,
      [sha256Hex(token)],
    );
    expect(session.rowCount).toBe(1);
    const row = await c.query(
      `select outcome from public.owner_login_rate_limit_reservations where id = $1`,
      [id],
    );
    expect(row.rows[0]?.outcome).toBe("succeeded");
  });

  test("confirm refuses an already-consumed reservation and activates NOTHING", async () => {
    const c = await db.client();
    const token = (
      await rpc<string>(c, "create_manager_session_pending", { p_manager_id: MANAGER_ID })
    ).data as string;
    const id = await reserve(c, "attempt-key-consumed-aaaaaa");
    await complete(c, id as string, false);

    const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: id,
    });
    expect(confirmed.data).toBe(false);
    const session = await c.query(
      `select 1 from public.manager_sessions where token_hash = $1`,
      [sha256Hex(token)],
    );
    expect(session.rowCount).toBe(0);
  });

  test("confirm with an unknown reservation activates nothing (fail closed)", async () => {
    const c = await db.client();
    const token = (
      await rpc<string>(c, "create_manager_session_pending", { p_manager_id: MANAGER_ID })
    ).data as string;
    const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: "00000000-0000-4000-8000-000000000000",
    });
    expect(confirmed.data).toBe(false);
    const session = await c.query(
      `select 1 from public.manager_sessions where token_hash = $1`,
      [sha256Hex(token)],
    );
    expect(session.rowCount).toBe(0);
  });
});
