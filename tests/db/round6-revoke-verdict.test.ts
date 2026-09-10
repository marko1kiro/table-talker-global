// R6-B RED: revocation must return an explicit, atomic, fail-closed VERDICT —
// not a boolean that conflates "already inactive" with "unknown token" and
// "kind mismatch". A tombstone (hashed, no raw token) proves a token was
// really revoked before, so idempotent logout can trust ALREADY_INACTIVE while
// junk tokens and kind-mismatched tokens are refused.
// Baseline (boolean RPC): every assertion below fails.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  connect,
  createTestDb,
  generateToken,
  mintActiveManagerSession,
  rawHexToken,
  rpc,
  scryptHash,
  sha256Hex,
  stopAll,
  type TestDb,
} from "./harness";

const R1 = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

let db: TestDb;

type Verdict = { verdict?: string };

beforeAll(async () => {
  db = await createTestDb("lime_r6_revoke");
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
  await c.query(`delete from public.staff_sessions`);
});

function rawToken(): string {
  return rawHexToken();
}

async function seedManagerSession(token: string): Promise<void> {
  const c = await db.client();
  await c.query(
    `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
     values ($1, $2, $3, now() + interval '12 hours')`,
    [MANAGER_ID, R1, sha256Hex(token)],
  );
}

async function seedStaffSession(kind: "super_admin" | "area_manager", token: string) {
  const c = await db.client();
  const table = kind === "super_admin" ? "super_admin_accounts" : "area_manager_accounts";
  const insert =
    kind === "super_admin"
      ? {
          sql: `insert into public.${table} (staff_id, full_name, password_hash, status, email)
                values ($1, 'Test User', 'x:y', 'aktif', $2) returning (id::text) as id`,
          params: ["sa.revoke", "revoke-user@example.test"],
        }
      : {
          sql: `insert into public.${table} (staff_id, full_name, password_hash, status)
                values ($1, 'Test User', 'x:y', 'aktif') returning (id::text) as id`,
          params: ["am.revoke"],
        };
  const id = await c.query<{ id: string }>(insert.sql, insert.params);
  await c.query(
    `insert into public.staff_sessions (session_kind, account_id, token_hash, expires_at)
     values ($1, $2, $3, now() + interval '12 hours')`,
    [kind, id.rows[0].id, sha256Hex(token)],
  );
}

describe("R6-B: structured revocation verdicts", () => {
  test("live manager token -> REVOKED", async () => {
    const token = rawToken();
    await seedManagerSession(token);
    const c = await db.client();
    const { data, error } = await rpc<Verdict>(c, "revoke_manager_session_by_token", {
      p_token: token,
    });
    expect(error).toBeNull();
    expect((data as Verdict)?.verdict).toBe("REVOKED");
  });

  test("re-revoking the same token -> authoritative ALREADY_INACTIVE (tombstone)", async () => {
    const token = rawToken();
    await seedManagerSession(token);
    const c = await db.client();
    await rpc(c, "revoke_manager_session_by_token", { p_token: token });
    const second = await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token });
    expect((second.data as Verdict)?.verdict).toBe("ALREADY_INACTIVE");
  });

  test("junk/never-issued token -> UNKNOWN_TOKEN, never ALREADY_INACTIVE", async () => {
    const c = await db.client();
    const junk = await rpc<Verdict>(c, "revoke_manager_session_by_token", {
      p_token: rawToken(),
    });
    expect((junk.data as Verdict)?.verdict).toBe("UNKNOWN_TOKEN");
  });

  test("newest-wins supersede leaves no tombstone: dead token is UNKNOWN_TOKEN (why cleanup tolerates it)", async () => {
    const c = await db.client();
    const oldToken = await mintActiveManagerSession(c, MANAGER_ID);
    // Second handshake deletes the first manager_sessions row WITHOUT a
    // tombstone (09060000 newest-wins). The surrendered old token must then
    // read as UNKNOWN_TOKEN — provably not live, hence the cleanup tolerance
    // in revokeManagerSessionByTokenIfLive({ tolerateUnknown }).
    await mintActiveManagerSession(c, MANAGER_ID);
    const { data } = await rpc<Verdict>(c, "revoke_manager_session_by_token", {
      p_token: oldToken,
    });
    expect((data as Verdict)?.verdict).toBe("UNKNOWN_TOKEN");
  });

  test("staff token passed to manager revoke -> KIND_MISMATCH, staff row untouched", async () => {
    const token = rawToken();
    await seedStaffSession("area_manager", token);
    const c = await db.client();
    const { data } = await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token });
    expect((data as Verdict)?.verdict).toBe("KIND_MISMATCH");
    const still = await c.query(`select 1 from public.staff_sessions where token_hash = $1`, [
      sha256Hex(token),
    ]);
    expect(still.rowCount).toBe(1);
  });

  test("manager token passed to staff revoke -> KIND_MISMATCH for both kinds", async () => {
    const token = rawToken();
    await seedManagerSession(token);
    const c = await db.client();
    for (const kind of ["super_admin", "area_manager"] as const) {
      const { data } = await rpc<Verdict>(c, "revoke_staff_session_by_token", {
        p_kind: kind,
        p_token: token,
      });
      expect((data as Verdict)?.verdict).toBe("KIND_MISMATCH");
    }
    const still = await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [
      sha256Hex(token),
    ]);
    expect(still.rowCount).toBe(1);
  });

  test("staff namespace: wrong kind -> KIND_MISMATCH; correct kind -> REVOKED", async () => {
    const token = generateToken();
    await seedStaffSession("super_admin", token);
    const c = await db.client();
    const wrong = await rpc<Verdict>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: token,
    });
    expect((wrong.data as Verdict)?.verdict).toBe("KIND_MISMATCH");
    const right = await rpc<Verdict>(c, "revoke_staff_session_by_token", {
      p_kind: "super_admin",
      p_token: token,
    });
    expect((right.data as Verdict)?.verdict).toBe("REVOKED");
    const retry = await rpc<Verdict>(c, "revoke_staff_session_by_token", {
      p_kind: "super_admin",
      p_token: token,
    });
    expect((retry.data as Verdict)?.verdict).toBe("ALREADY_INACTIVE");
  });

  test("concurrent revoke of the same token: exactly one REVOKED, other ALREADY_INACTIVE", async () => {
    const token = rawToken();
    await seedManagerSession(token);
    const c1 = await connect(db.connectionString);
    const c2 = await connect(db.connectionString);
    const results = await Promise.all([
      rpc<Verdict>(c1, "revoke_manager_session_by_token", { p_token: token }),
      rpc<Verdict>(c2, "revoke_manager_session_by_token", { p_token: token }),
    ]);
    const verdicts = results.map((r) => (r.data as Verdict)?.verdict);
    expect(verdicts.filter((v) => v === "REVOKED")).toHaveLength(1);
    expect(verdicts.filter((v) => v === "ALREADY_INACTIVE")).toHaveLength(1);
    await c1.end();
    await c2.end();
  });

  test("tombstones never store the raw token", async () => {
    const token = rawToken();
    await seedManagerSession(token);
    const c = await db.client();
    await rpc(c, "revoke_manager_session_by_token", { p_token: token });
    const raw = await c.query(
      `select count(*)::int as n from public.revoked_session_tombstones where token_hash = $1`,
      [token],
    );
    expect(raw.rows[0].n).toBe(0);
    const hashed = await c.query(
      `select count(*)::int as n from public.revoked_session_tombstones where token_hash = $1`,
      [sha256Hex(token)],
    );
    expect(hashed.rows[0].n).toBe(1);
  });
});
