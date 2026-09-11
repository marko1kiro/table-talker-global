// R6-A RED: disposable-Postgres proof that the manager session lifecycle is
// pending -> (browser handoff) -> confirm -> active, and that a pending token
// is invisible to EVERY manager-token consumer. Runs the FULL migration chain
// on an embedded Postgres. Baseline a239081 fails these: pending rows live in
// manager_sessions (usable) and the login path mints active sessions.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  connect,
  createTestDb,
  rawHexToken,
  rpc,
  rpcNamed,
  rpcRows,
  scryptHash,
  sha256Hex,
  stopAll,
  type TestDb,
} from "./harness";
import { loginManagerCore } from "../../src/lib/manager-auth.server";
import { managerLoginHandoffCore } from "../../src/lib/manager-login-handoff";
import { writePendingManagerHandoff } from "../../src/lib/manager-pending-handoff";
import { verifyManagerPassword } from "../../src/lib/manager-password.server";

const R1 = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const MANAGER_USER = "budi.santoso";
const MANAGER_PW = "correct horse battery staple";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb("lime_r6_pending");
  const c = await db.client();
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin', 'sha256'), 'hex'), now())`,
    [R1],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, $2, 'Budi Santoso', $3, $4, 'aktif')`,
    [MANAGER_ID, MANAGER_USER, R1, await scryptHash(MANAGER_PW)],
  );
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

// Test scaffolding: each test starts from a clean session state.
afterEach(async () => {
  const c = await db.client();
  await c.query(`delete from public.manager_sessions`);
  await c.query(`delete from public.manager_pending_sessions`);
});

function rawToken(): string {
  return rawHexToken();
}

// R6-C: the handoff identity carries the rate-limit reservation finalized by
// confirm/cleanup. This DB test exercises the pending lifecycle without the
// limiter, so a well-formed throwaway uuid stands in (unknown reservation ->
// cleanup banks a no-op UNKNOWN_RESERVATION).
async function reserveFor(c: Client, key: string): Promise<string> {
  const result = await rpcRows<{ reservation_id: string }>(c, "reserve_owner_login_attempt", {
    p_client_bucket_hash: sha256Hex(`${key}:client`),
    p_ip_bucket_hash: sha256Hex(`${key}:ip`),
    p_attempt_key: key,
  });
  const id = result.rows[0]?.reservation_id;
  if (!id && !result.error && key.length < 16) return reserveFor(c, `${key}-attempt-key`);
  if (!id) throw new Error(`reservation failed: ${result.error ?? JSON.stringify(result.rows)}`);
  return id;
}

async function mintPending(
  c: Client,
  key: string,
): Promise<{ token: string; reservationId: string }> {
  const reservationId = await reserveFor(c, key);
  const token = rawHexToken();
  const result = await rpc<boolean>(c, "create_manager_session_pending", {
    p_manager_id: MANAGER_ID,
    p_reservation_id: reservationId,
    p_token: token,
  });
  if (result.data !== true) throw new Error(`mint failed: ${result.error ?? "unknown"}`);
  return { token, reservationId };
}

/** Wired supabase-shaped rpc caller over the real disposable DB. */
function dbRpc(c: Client) {
  return async (
    fn: string,
    params: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }> => {
    const r = await rpc(c, fn, params);
    return { data: r.data, error: r.error ? { message: r.error } : null };
  };
}

async function activeSessionCount(): Promise<number> {
  const c = await db.client();
  const r = await c.query(`select count(*)::int as n from public.manager_sessions`);
  return Number(r.rows[0]?.n ?? 0);
}

describe("R6-A: pending sessions are invisible to every manager-token consumer", () => {
  test("pending token is not resolvable by get_manager_id_by_token", async () => {
    const c = await db.client();
    const { token } = await mintPending(c, "pending-invisible-aaaa");
    expect(token).toBeTruthy();
    const resolved = await rpc(c, "get_manager_id_by_token", { p_token: token });
    expect(resolved.data).toBeNull();
  });

  test("pending token yields no dashboard snapshot, stats, thread, instructions, crew, realtime bind", async () => {
    const c = await db.client();
    const { token } = await mintPending(c, "pending-invisible-aaaa");

    const snapshot = await rpc(c, "get_manager_snapshot", { p_manager_token: token });
    expect(snapshot.data).toBeNull();

    const stats = await rpc(c, "get_manager_daily_stats", {
      p_manager_token: token,
      p_date: null,
    });
    expect(stats.data).toBeNull();

    const thread = await rpc(c, "get_instruction_thread", {
      p_manager_token: token,
      p_date: null,
    });
    expect(thread.data).toBeNull();

    const sent = await rpc(c, "send_manager_instruction", {
      p_manager_token: token,
      p_target_type: "all",
      p_target_role_session_id: null,
      p_message: "hello",
    });
    expect(sent.data).toBeNull();

    const crew = await rpcRows(c, "get_manager_active_crew", { p_manager_token: token });
    expect(crew.rows).toHaveLength(0);

    const history = await rpcRows(c, "get_manager_crew_history", {
      p_manager_token: token,
      p_date: null,
    });
    expect(history.rows).toHaveLength(0);

    // The realtime binder raises INVALID_SESSION on any token that is not a
    // usable active row — a pending token must never bind a channel.
    const b = await connect(db.connectionString);
    await b.query("select set_config('request.jwt.claim.sub', $1, false)", [
      "11111111-1111-4111-8111-111111111199",
    ]);
    const bound = await rpcNamed<boolean>(b, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: token,
    });
    expect(bound.error ?? "").toMatch(/INVALID_SESSION/);
    expect(bound.data).toBeNull();
    await b.end();
  });

  test("confirm activates exactly once; retry idempotent; exactly one active row", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending(c, "confirm-once");

    const first = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    expect(first.data).toBe(true);

    const retry = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    expect(retry.data).toBe(true);

    const resolved = await rpc(c, "get_manager_id_by_token", { p_token: token });
    expect(resolved.data).toBe(MANAGER_ID);

    const n = await activeSessionCount();
    expect(n).toBe(1);
  });

  test("confirm retry WITH the same reservation id stays true (lost-response idempotency)", async () => {
    const c = await db.client();
    // Mint a REAL rate-limit reservation: the production handoff always
    // confirms with one, and the first confirm consumes it — the retry must
    // still return true via the confirmed tombstone, never false.
    const reservationId = await reserveFor(c, "confirm-retry-idempotency");
    const token = rawHexToken();
    expect(
      (
        await rpc<boolean>(c, "create_manager_session_pending", {
          p_manager_id: MANAGER_ID,
          p_reservation_id: reservationId,
          p_token: token,
        })
      ).data,
    ).toBe(true);

    const first = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    expect(first.data).toBe(true);

    const retry = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    expect(retry.data).toBe(true);
    expect(await activeSessionCount()).toBe(1);

    // The retry must not have re-decided or flipped the reservation outcome.
    const outcome = await c.query(
      `select consumed_at is not null as decided, outcome
       from public.owner_login_rate_limit_reservations where id = $1`,
      [reservationId],
    );
    expect(outcome.rows[0]).toMatchObject({ decided: true, outcome: "succeeded" });
  });

  test("token born active cannot be confirmed into the handshake", async () => {
    const c = await db.client();
    const token = rawToken();
    await c.query(
      `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '12 hours')`,
      [MANAGER_ID, R1, sha256Hex(token)],
    );
    const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: token,
      p_reservation_id: "00000000-0000-4000-8000-00000000dead",
    });
    expect(confirmed.data).toBe(false);
    await c.query(`delete from public.manager_sessions where token_hash = $1`, [sha256Hex(token)]);
  });

  test("concurrent confirm creates exactly one active session", async () => {
    const c1 = await connect(db.connectionString);
    const c2 = await connect(db.connectionString);
    const reservationId = await reserveFor(c1, "concurrent-confirm");
    const token = rawHexToken();
    expect(
      (
        await rpc<boolean>(c1, "create_manager_session_pending", {
          p_manager_id: MANAGER_ID,
          p_reservation_id: reservationId,
          p_token: token,
        })
      ).data,
    ).toBe(true);

    const [a, b] = await Promise.all([
      rpc<boolean>(c1, "confirm_manager_session", {
        p_token: token,
        p_reservation_id: reservationId,
      }),
      rpc<boolean>(c2, "confirm_manager_session", {
        p_token: token,
        p_reservation_id: reservationId,
      }),
    ]);
    expect([a.data, b.data]).toContain(true);
    const n = await activeSessionCount();
    expect(n).toBe(1);
    await c1.end();
    await c2.end();
  });

  test("end-to-end: login mints pending; snapshot denied until confirm; handoff failure leaves zero active sessions", async () => {
    const c = await db.client();
    const firstReservationId = await reserveFor(c, "login-handoff-first");
    const result = await loginManagerCore(
      { idManager: MANAGER_USER, password: MANAGER_PW, rateLimitReservationId: firstReservationId },
      { rpc: dbRpc(c), verify: verifyManagerPassword },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Pending: dashboard data must be denied before the browser confirms.
    const snapshot = await rpc(c, "get_manager_snapshot", {
      p_manager_token: result.managerToken,
    });
    expect(snapshot.data).toBeNull();

    // Handoff failure (navigation throws) must clean everything up.
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    };
    const handoff = await managerLoginHandoffCore(
      {
        idManager: result.idManager,
        fullName: result.fullName,
        restaurantId: result.restaurantId,
        restaurantDisplayName: result.restaurantDisplayName,
        restaurantCode: result.restaurantCode,
        managerToken: result.managerToken,
        rateLimitReservationId: firstReservationId,
      },
      {
        // P1-3: the real recovery-record write, so the pending pair is
        // recoverable before any other browser-side work.
        persistPending: (pendingIdentity) => writePendingManagerHandoff(storage, pendingIdentity),
        ensureAccessToken: async () => "anon-access-token",
        getStorage: () => storage,
        writeIdentity: (s, identity) => {
          s?.setItem("tt-manager-identity", JSON.stringify(identity));
          return identity;
        },
        setReminderFlag: () => undefined,
        navigate: async () => {
          throw new Error("navigation exploded");
        },
        confirmHandoff: async () => true,
        reconcileHandoff: async () => "pending",
        cleanupPending: async (managerToken, reservationId) => {
          const cleaned = await rpc<boolean>(c, "cleanup_pending_manager_session", {
            p_token: managerToken,
            p_reservation_id: reservationId,
          });
          if (cleaned.error || cleaned.data !== true) throw new Error("cleanup failed");
        },
      },
    );
    expect(handoff.ok).toBe(false);
    expect(await activeSessionCount()).toBe(0);

    // A cleaned-up pending token can never be confirmed afterwards.
    const dead = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: result.managerToken,
      p_reservation_id: firstReservationId,
    });
    expect(dead.data).toBe(false);

    // Successful path: a fresh login + confirm makes the snapshot available.
    const secondReservationId = await reserveFor(c, "login-handoff-second");
    const again = await loginManagerCore(
      {
        idManager: MANAGER_USER,
        password: MANAGER_PW,
        rateLimitReservationId: secondReservationId,
      },
      { rpc: dbRpc(c), verify: verifyManagerPassword },
    );
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const confirmed = await rpc<boolean>(c, "confirm_manager_session", {
      p_token: again.managerToken,
      p_reservation_id: secondReservationId,
    });
    expect(confirmed.data).toBe(true);
    const after = await rpc(c, "get_manager_snapshot", { p_manager_token: again.managerToken });
    expect(after.data).not.toBeNull();
  });
});
