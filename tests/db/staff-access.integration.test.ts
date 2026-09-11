// Executable DB-level proof for Poin 2 (TASKLET review round 2). Runs the FULL
// migration chain against a disposable vanilla Postgres (embedded locally,
// service container in CI via TEST_DATABASE_URL) with a legacy-schema seed
// inserted between the pre-Poin-2 and Poin-2 migrations, then exercises the
// real RPCs — including true parallel connections for race conditions and
// serialized AM lifecycle semantics.
// Production/staging Supabase is never contacted.
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import {
  connect,
  createTestDb,
  generateToken,
  migrationFiles,
  mintActiveManagerSession,
  rpc,
  rpcNamed,
  rpcOk,
  rpcRows,
  scryptHash,
  sha256Hex,
  stopAll,
  type LegacySeed,
  type TestDb,
} from "./harness";
import { verifyManagerPassword } from "../../src/lib/manager-password.server";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const R3 = "33333333-3333-4333-8333-333333333333";

const seedLegacy: LegacySeed = async (c) => {
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at) values
       ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('test-pin-1', 'sha256'), 'hex'), now()),
       ($2, 'RESTO-2', 'Resto Dua', encode(extensions.digest('test-pin-2', 'sha256'), 'hex'), now()),
       ($3, 'RESTO-3', 'Resto Tiga', encode(extensions.digest('test-pin-3', 'sha256'), 'hex'), now())`,
    [R1, R2, R3],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status) values
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'budi.santoso', 'Budi Santoso', $1, 'oldsalt:oldhash', 'aktif'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'AgusKasir', 'Agus Kasir', $1, 'oldsalt:oldhash', 'aktif')`,
    [R1],
  );
};

// Duplicate legacy IDs that collide case-insensitively: the backfill migration
// must FAIL CLOSED (review A2).
const seedDuplicateLegacy: LegacySeed = async (c) => {
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at) values
       ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('test-pin-1', 'sha256'), 'hex'), now())`,
    [R1],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status) values
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'admin', 'Admin Satu', $1, 'x:y', 'aktif'),
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'ADMIN', 'Admin Dua', $1, 'x:y', 'aktif')`,
    [R1],
  );
};

type RpcJson = { ok?: boolean; error?: string; id?: string | null };

let db: TestDb;
let sa1Id = "";
let sa2Id = "";
let am1Id = "";
let am2Id = "";
let managerId = "";
let bootstrapRawToken = "";
let bootstrapWinnerStaffId = "";

async function freshClient(): Promise<Client> {
  return connect(db.connectionString);
}

async function parallel<T>(fns: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(fns.map((fn) => fn()));
}

/** Calls a mutating RPC and asserts the jsonb verdict contract (review B8). */
async function verdict(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
): Promise<RpcJson> {
  const result = await rpc<RpcJson>(client, fn, params);
  expect(result.error).toBeNull();
  const data = result.data as RpcJson | null;
  expect(data !== null && typeof data === "object" && typeof data.ok === "boolean").toBe(true);
  return data as RpcJson;
}

async function okVerdict(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
): Promise<RpcJson> {
  const v = await verdict(client, fn, params);
  expect(v.ok).toBe(true);
  return v;
}

async function expectDenial(
  client: Client,
  fn: string,
  params: Record<string, unknown>,
  code: string,
): Promise<RpcJson> {
  const v = await verdict(client, fn, params);
  expect(v.ok).toBe(false);
  expect(v.error).toBe(code);
  return v;
}

async function reserveResetAttempt(
  client: Client,
  label: string,
): Promise<{ reservationId: string; clientHash: string; ipHash: string; attemptKey: string }> {
  const nonce = generateToken();
  const clientHash = sha256Hex(`${label}:client:${nonce}`);
  const ipHash = sha256Hex(`${label}:ip:${nonce}`);
  const attemptKey = `${label}:${nonce}`;
  const reservation = await rpcRows<{ reservation_id: string }>(
    client,
    "reserve_owner_login_attempt",
    {
      p_client_bucket_hash: clientHash,
      p_ip_bucket_hash: ipHash,
      p_attempt_key: attemptKey,
    },
  );
  expect(reservation.error).toBeNull();
  const reservationId = reservation.rows[0]?.reservation_id;
  expect(reservationId).toBeTruthy();
  return { reservationId, clientHash, ipHash, attemptKey };
}

async function submitResetRpc(
  client: Client,
  fn: "submit_manager_reset_request" | "submit_am_reset_request",
  params: { p_staff_id: string; p_candidate_hash: string },
): Promise<{ data: boolean | null; error: string | null }> {
  const { reservationId } = await reserveResetAttempt(client, `reset-helper-${fn}`);
  return rpc<boolean>(client, fn, { ...params, p_reservation_id: reservationId });
}

async function submitResetOk(
  client: Client,
  fn: "submit_manager_reset_request" | "submit_am_reset_request",
  params: { p_staff_id: string; p_candidate_hash: string },
): Promise<boolean> {
  const result = await submitResetRpc(client, fn, params);
  expect(result.error).toBeNull();
  return result.data === true;
}

async function waitForLockWait(observer: Client, applicationName: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await scalar(
      observer,
      `select count(*) from pg_stat_activity
       where application_name = $1 and wait_event_type = 'Lock'`,
      [applicationName],
    );
    if (waiting === 1) return;
    await sleep(20);
  }
  throw new Error(`timed out waiting for ${applicationName} to block on a lock`);
}

async function scalar(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query(sql, params);
  return Number(Object.values(result.rows[0] ?? { n: 0 })[0]);
}

async function oneText(client: Client, sql: string, params: unknown[] = []): Promise<string> {
  const result = await client.query(sql, params);
  return String(Object.values(result.rows[0] ?? { v: "" })[0]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Restores: both AMs aktif; am1+am2 assigned to R1; am1 assigned to R2 ONLY. */
async function restoreAmState(c: Client): Promise<void> {
  // Undo any assignment side effects from in-flight race tests (direct cleanup
  // is test scaffolding only, not a production path). Canonical state:
  // am1 -> {R1, R2}, am2 -> {R1}.
  await c.query(
    `delete from public.area_manager_assignments
     where removed_at is null
       and not (area_manager_id = $1 and restaurant_id in ($2, $4))
       and not (area_manager_id = $3 and restaurant_id = $2)`,
    [am1Id, R1, am2Id, R2],
  );
  await okVerdict(c, "set_area_manager_status", {
    p_actor_id: sa1Id,
    p_target_id: am1Id,
    p_new_status: "aktif",
  });
  await okVerdict(c, "set_area_manager_status", {
    p_actor_id: sa1Id,
    p_target_id: am2Id,
    p_new_status: "aktif",
  });
  await okVerdict(c, "assign_area_manager", {
    p_actor_id: sa1Id,
    p_am_id: am1Id,
    p_restaurant_id: R1,
  });
  await okVerdict(c, "assign_area_manager", {
    p_actor_id: sa1Id,
    p_am_id: am2Id,
    p_restaurant_id: R1,
  });
  await okVerdict(c, "assign_area_manager", {
    p_actor_id: sa1Id,
    p_am_id: am1Id,
    p_restaurant_id: R2,
  });
}

beforeAll(async () => {
  db = await createTestDb("lime_staff_p2", { seedLegacy });
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

describe("migration replay on legacy-shaped schema", () => {
  test("full chain replays cleanly from empty DB with legacy seed", async () => {
    expect(migrationFiles().length).toBeGreaterThan(70);
    const claimed = await db
      .client()
      .then((c) =>
        c.query(`select staff_id, account_kind from public.staff_id_registry order by staff_id`),
      );
    const ids = claimed.rows.map((r) => String(r.staff_id));
    expect(ids).toContain("budi.santoso");
    expect(ids).toContain("aguskasir"); // legacy 'AgusKasir' claimed lowercased
    expect(claimed.rows.every((r) => r.account_kind === "manager")).toBe(true);
  });

  test("Point 1 preserved: purge RPC absent", async () => {
    const n = await scalar(
      await db.client(),
      `select count(*) as n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = 'super_admin_purge_restaurant_test_data'`,
    );
    expect(n).toBe(0);
  });

  test("backfill is a hard gate on case-insensitive collisions", async () => {
    const c = await db.client();
    // The unique index manager_accounts_lower_id_manager_uq (created by the
    // backfill migration) makes ANY case-insensitive duplicate of a legacy ID
    // impossible to insert — the fail-closed guarantee review A2 demands.
    await expect(
      c.query(
        `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
         values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 'BUDI.SANTOSO', 'Collision', $1, 'x:y', 'aktif')`,
        [R3],
      ),
    ).rejects.toThrow(/manager_accounts_lower_id_manager_uq/);
  });

  test("duplicate legacy case-insensitive IDs make the migration fail closed (A2)", async () => {
    await expect(
      createTestDb("lime_staff_p2_dup", { seedLegacy: seedDuplicateLegacy }),
    ).rejects.toThrow(/STAFF_ID_BACKFILL_COLLISION/);
    // The failed database is dropped with (force) by the next createTestDb call
    // that reuses the name; nothing is kept alive here.
  });
});

describe("legacy mixed-case manager identity (review A2)", () => {
  test("legacy 'AgusKasir' resolves under every casing variant for login", async () => {
    const c = await db.client();
    for (const variant of ["AgusKasir", "aguskasir", "AGUSKASIR", " aGusKasIr "]) {
      const cred = await rpcOk<Record<string, unknown>>(c, "get_manager_credential", {
        p_id_manager: variant,
      });
      expect(String(cred.id)).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2");
    }
  });

  test("reset request resolves legacy mixed-case IDs case-insensitively", async () => {
    const c = await db.client();
    const candidate = await scryptHash("ResetLegacy#1");
    expect(
      await submitResetOk(c, "submit_manager_reset_request", {
        p_staff_id: "AGUSKASIR",
        p_candidate_hash: candidate,
      }),
    ).toBe(true);
    // Clean up the pending request so later suites start clean.
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    ]);
  });

  test("a mixed-case legacy ID cannot be re-claimed by another role", async () => {
    const c = await db.client();
    const claim = await rpc(c, "claim_staff_id", {
      p_staff_id: "AGUSKASIR",
      p_kind: "area_manager",
      p_account_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    expect(claim.error ?? "").toContain("STAFF_ID_TAKEN");
    const claim2 = await rpc(c, "claim_staff_id", {
      p_staff_id: "aguskasir",
      p_kind: "manager",
      p_account_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccd",
    });
    expect(claim2.error ?? "").toContain("STAFF_ID_TAKEN");
  });
});

describe("bootstrap: CSPRNG token, one-time race, real acceptance", () => {
  test("two parallel bootstrap creations produce exactly one account", async () => {
    const rawA = generateToken();
    const rawB = generateToken();
    const c1 = await freshClient();
    const c2 = await freshClient();
    const [a, b] = await parallel([
      () =>
        rpc<RpcJson>(c1, "bootstrap_create_super_admin", {
          p_staff_id: "sa.utama",
          p_full_name: "SA Utama",
          p_email: "sa.utama@example.test",
          p_verify_token_hash: sha256Hex(rawA),
        }),
      () =>
        rpc<RpcJson>(c2, "bootstrap_create_super_admin", {
          p_staff_id: "sa.kedua",
          p_full_name: "SA Kedua",
          p_email: "sa.kedua@example.test",
          p_verify_token_hash: sha256Hex(rawB),
        }),
    ]);
    await c1.end();
    await c2.end();
    const winners = [a, b].filter((r) => !r.error && (r.data as RpcJson)?.ok === true);
    expect(winners).toHaveLength(1);
    const loser = (a.data as RpcJson)?.ok === true ? b : a;
    expect(loser.error).toBeNull();
    expect((loser.data as RpcJson).error).toBe("BOOTSTRAP_CLOSED");
    bootstrapRawToken = (a.data as RpcJson)?.ok === true ? rawA : rawB;
    bootstrapWinnerStaffId = (a.data as RpcJson)?.ok === true ? "sa.utama" : "sa.kedua";
    sa1Id = String((winners[0].data as RpcJson).id);
  });

  test("raw token accepted end-to-end; gate closes permanently; password stamped (A1)", async () => {
    const c = await db.client();
    const accepted = await okVerdict(c, "accept_super_admin_invite", {
      p_staff_id: bootstrapWinnerStaffId,
      p_token: bootstrapRawToken,
      p_password_hash: await scryptHash("PasswordKuat#1"),
    });
    expect(accepted.ok).toBe(true);
    const state = (await rpcOk<Record<string, unknown>>(c, "bootstrap_super_admin_state", {})) as {
      open: boolean;
      active_count: number;
    };
    expect(state.open).toBe(false);
    expect(Number(state.active_count)).toBe(1);
    const stamp = await c.query(
      `select password_changed_at from public.super_admin_accounts where id = $1`,
      [sa1Id],
    );
    expect(stamp.rows[0].password_changed_at).not.toBeNull();
    await expectDenial(
      c,
      "accept_super_admin_invite",
      {
        p_staff_id: bootstrapWinnerStaffId,
        p_token: bootstrapRawToken,
        p_password_hash: "x:y",
      },
      "INVALID_INVITATION",
    );
    const denied = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'super_admin.activated' and result = 'denied' and reason = 'invalid invitation'`,
    );
    expect(denied).toBeGreaterThanOrEqual(1);
  });
});

describe("manager creation: atomic claim, collisions, scope", () => {
  test("Super Admin creates a manager; registry row lands atomically", async () => {
    const c = await db.client();
    const created = await okVerdict(c, "create_manager_account", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_staff_id: "kasir.satgas01",
      p_full_name: "Kasir Satgas",
      p_restaurant_id: R1,
      p_password_hash: await scryptHash("AwalManager1"),
    });
    managerId = String(created.id);
    expect(managerId).toMatch(/^[0-9a-f-]{36}$/);
    const inRegistry = await scalar(
      c,
      `select count(*) as n from public.staff_id_registry
       where staff_id = 'kasir.satgas01' and account_kind = 'manager' and account_id = $1`,
      [managerId],
    );
    expect(inRegistry).toBe(1);
  });

  test("collisions rejected across registry, legacy rows (case-insensitive), and roles", async () => {
    const c = await db.client();
    const hash = await scryptHash("AwalManager1");
    await expectDenial(
      c,
      "create_manager_account",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_staff_id: "KASIR.SATGAS01",
        p_full_name: "Dup",
        p_restaurant_id: R1,
        p_password_hash: hash,
      },
      "STAFF_ID_TAKEN",
    );
    await expectDenial(
      c,
      "create_manager_account",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_staff_id: "AgusKasir",
        p_full_name: "Legacy clash",
        p_restaurant_id: R1,
        p_password_hash: hash,
      },
      "STAFF_ID_TAKEN",
    );
    await expectDenial(
      c,
      "create_manager_account",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_staff_id: bootstrapWinnerStaffId,
        p_full_name: "Cross-role clash",
        p_restaurant_id: R1,
        p_password_hash: hash,
      },
      "STAFF_ID_TAKEN",
    );
  });

  test("two concurrent creations of one ID: exactly one winner", async () => {
    const c1 = await freshClient();
    const c2 = await freshClient();
    const hash = await scryptHash("AwalManager1");
    const [a, b] = await parallel([
      () =>
        rpc<RpcJson>(c1, "create_manager_account", {
          p_actor_kind: "super_admin",
          p_actor_id: sa1Id,
          p_staff_id: "race.manager",
          p_full_name: "Race A",
          p_restaurant_id: R1,
          p_password_hash: hash,
        }),
      () =>
        rpc<RpcJson>(c2, "create_manager_account", {
          p_actor_kind: "super_admin",
          p_actor_id: sa1Id,
          p_staff_id: "race.manager",
          p_full_name: "Race B",
          p_restaurant_id: R1,
          p_password_hash: hash,
        }),
    ]);
    await c1.end();
    await c2.end();
    const wins = [a, b].filter((r) => !r.error && (r.data as RpcJson)?.ok === true);
    expect(wins).toHaveLength(1);
    const loss = (a.data as RpcJson)?.ok === true ? b : a;
    expect(loss.error).toBeNull();
    expect((loss.data as RpcJson).error).toBe("STAFF_ID_TAKEN");
  });

  test("Area Manager in scope creates; out-of-scope denied with durable audit", async () => {
    const c = await db.client();
    await okVerdict(c, "create_area_manager", {
      p_actor_id: sa1Id,
      p_staff_id: "am.satu",
      p_full_name: "AM Satu",
      p_password_hash: await scryptHash("AmPass#111"),
    });
    await okVerdict(c, "create_area_manager", {
      p_actor_id: sa1Id,
      p_staff_id: "am.dua",
      p_full_name: "AM Dua",
      p_password_hash: await scryptHash("AmPass#222"),
    });
    am1Id = await oneText(
      c,
      `select id::text as n from public.area_manager_accounts where staff_id = 'am.satu'`,
    );
    am2Id = await oneText(
      c,
      `select id::text as n from public.area_manager_accounts where staff_id = 'am.dua'`,
    );
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R1,
    });
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R1,
    });
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R2,
    });

    const created = await okVerdict(c, "create_manager_account", {
      p_actor_kind: "area_manager",
      p_actor_id: am1Id,
      p_staff_id: "kasir.restodua",
      p_full_name: "Kasir Resto Dua",
      p_restaurant_id: R2,
      p_password_hash: await scryptHash("AwalManager2"),
    });
    expect(created.ok).toBe(true);
    await expectDenial(
      c,
      "create_manager_account",
      {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_staff_id: "kasir.restotiga",
        p_full_name: "Out of scope",
        p_restaurant_id: R3,
        p_password_hash: "x:y",
      },
      "NOT_AUTHORIZED",
    );
    const denied = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager.create' and actor_id = $1 and restaurant_id = $2
         and result = 'denied' and reason = 'not authorized'`,
      [am1Id, R3],
    );
    expect(denied).toBe(1);
    await okVerdict(c, "create_manager_account", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_staff_id: "kasir.restotiga",
      p_full_name: "Kasir Resto Tiga",
      p_restaurant_id: R3,
      p_password_hash: await scryptHash("AwalManager3"),
    });
  });
});

describe("AM scope revocation is serialized with every scoped action (review A3)", () => {
  /**
   * Deterministic parallel interleaving: a helper transaction holds the
   * 'area_manager_lifecycle' advisory lock (the same key every scoped action
   * must take), the scoped action is launched on another connection and
   * BLOCKS on the lock, then the revocation commits inside the holder
   * transaction before the lock is released. The blocked action acquires the
   * lock only AFTER the revocation committed and must fail its re-check.
   */
  async function actionBlockedByPendingRevoke(
    action: (client: Client) => Promise<{ data: unknown; error: string | null }>,
  ): Promise<RpcJson> {
    const holder = await freshClient();
    const actor = await freshClient();
    try {
      await holder.query("begin");
      await holder.query(`select pg_advisory_xact_lock(hashtext('area_manager_lifecycle'))`);
      const actionPromise = action(actor);
      await sleep(200); // let the action queue on the lock
      await okVerdict(holder, "revoke_area_manager_assignment", {
        p_actor_id: sa1Id,
        p_am_id: am1Id,
        p_restaurant_id: R1,
      });
      await holder.query("commit"); // revoke committed; lock released
      const result = await actionPromise;
      expect(result.error).toBeNull();
      return result.data as RpcJson;
    } finally {
      await holder.end().catch(() => undefined);
      await actor.end().catch(() => undefined);
      await restoreAmState(await db.client());
    }
  }

  test("revoke commits while AM create-manager is blocked -> create fails", async () => {
    const result = await actionBlockedByPendingRevoke((client) =>
      rpc<RpcJson>(client, "create_manager_account", {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_staff_id: "kasir.afterrevoke",
        p_full_name: "Too Late",
        p_restaurant_id: R1,
        p_password_hash: "salt:hash",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_AUTHORIZED");
    const created = await scalar(
      await db.client(),
      `select count(*) as n from public.manager_accounts where lower(id_manager) = 'kasir.afterrevoke'`,
    );
    expect(created).toBe(0);
  });

  test("revoke commits while AM rename is blocked -> rename fails", async () => {
    const result = await actionBlockedByPendingRevoke((client) =>
      rpc<RpcJson>(client, "update_staff_profile", {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_target_kind: "manager",
        p_target_id: managerId,
        p_full_name: "Renamed After Revoke",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_AUTHORIZED");
    const name = await oneText(
      await db.client(),
      `select full_name as n from public.manager_accounts where id = $1`,
      [managerId],
    );
    expect(name).toBe("Kasir Satgas");
  });

  test("revoke commits while AM status change is blocked -> status change fails", async () => {
    const result = await actionBlockedByPendingRevoke((client) =>
      rpc<RpcJson>(client, "set_manager_status", {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_manager_id: managerId,
        p_new_status: "nonaktif",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_AUTHORIZED");
    const status = await oneText(
      await db.client(),
      `select status as n from public.manager_accounts where id = $1`,
      [managerId],
    );
    expect(status).toBe("aktif");
  });

  test("revoke commits while AM reset decision is blocked -> decision fails with durable audit", async () => {
    const c = await db.client();
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [managerId]);
    expect(
      await submitResetOk(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: await scryptHash("ResetDuringRace#1"),
      }),
    ).toBe(true);
    const requestId = await oneText(
      c,
      `select id::text as n from public.manager_reset_requests where manager_id = $1 and status = 'pending'`,
      [managerId],
    );
    const result = await actionBlockedByPendingRevoke((client) =>
      rpc<RpcJson>(client, "decide_manager_reset", {
        p_decider_kind: "area_manager",
        p_decider_id: am1Id,
        p_request_id: requestId,
        p_decision: "approved",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_AUTHORIZED");
    const stillPending = await scalar(
      c,
      `select count(*) as n from public.manager_reset_requests where id = $1 and status = 'pending'`,
      [requestId],
    );
    expect(stillPending).toBe(1);
    const denied = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager_reset.decide' and actor_id = $1 and result = 'denied' and reason = 'out of scope'`,
      [am1Id],
    );
    expect(denied).toBeGreaterThanOrEqual(1);
    await c.query(`delete from public.manager_reset_requests where id = $1`, [requestId]);
  });

  test("AM deactivated first -> in-flight scoped action still fails", async () => {
    const holder = await freshClient();
    const actor = await freshClient();
    try {
      await holder.query("begin");
      await holder.query(`select pg_advisory_xact_lock(hashtext('area_manager_lifecycle'))`);
      const actionPromise = rpc<RpcJson>(actor, "create_manager_account", {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_staff_id: "kasir.afterdeact",
        p_full_name: "Too Late",
        p_restaurant_id: R2,
        p_password_hash: "salt:hash",
      });
      await sleep(200);
      // am1 must stay assignable-in-scope for the action attempt, but the
      // deactivation below (committed under the same lock) revokes that right.
      await okVerdict(holder, "assign_area_manager", {
        p_actor_id: sa1Id,
        p_am_id: am2Id,
        p_restaurant_id: R2,
      });
      await okVerdict(holder, "set_area_manager_status", {
        p_actor_id: sa1Id,
        p_target_id: am1Id,
        p_new_status: "nonaktif",
      });
      await holder.query("commit");
      const result = await actionPromise;
      expect(result.error).toBeNull();
      expect((result.data as RpcJson).ok).toBe(false);
      expect((result.data as RpcJson).error).toBe("NOT_AUTHORIZED");
    } finally {
      await holder.end().catch(() => undefined);
      await actor.end().catch(() => undefined);
      await restoreAmState(await db.client());
    }
  });

  test("authorized action commits first; revocation then applies on top", async () => {
    const c = await db.client();
    await restoreAmState(c);
    const created = await okVerdict(c, "create_manager_account", {
      p_actor_kind: "area_manager",
      p_actor_id: am1Id,
      p_staff_id: "kasir.firstwins",
      p_full_name: "First Wins",
      p_restaurant_id: R1,
      p_password_hash: await scryptHash("FirstWins#1"),
    });
    expect(created.ok).toBe(true);
    const revoked = await okVerdict(c, "revoke_area_manager_assignment", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R1,
    });
    expect(revoked.ok).toBe(true);
    const still = await scalar(
      c,
      `select count(*) as n from public.manager_accounts where lower(id_manager) = 'kasir.firstwins'`,
    );
    expect(still).toBe(1);
    const removed = await scalar(
      c,
      `select count(*) as n from public.area_manager_assignments
       where area_manager_id = $1 and restaurant_id = $2 and removed_at is null`,
      [am1Id, R1],
    );
    expect(removed).toBe(0);
  });
});

describe("last-active invariants hold under parallelism", () => {
  test("parallel Super Admin deactivations never reach zero active", async () => {
    const c = await db.client();
    const raw = generateToken();
    const invited = await okVerdict(c, "create_super_admin_invite", {
      p_staff_id: "sa.mitra",
      p_full_name: "SA Mitra",
      p_email: "sa.mitra@example.test",
      p_invitation_token_hash: sha256Hex(raw),
      p_creator_id: sa1Id,
    });
    sa2Id = String(invited.id);
    const c1 = await freshClient();
    const c2 = await freshClient();
    try {
      await okVerdict(c1, "accept_super_admin_invite", {
        p_staff_id: "sa.mitra",
        p_token: raw,
        p_password_hash: await scryptHash("PasswordKuat#2"),
      });
      const [a, b] = await parallel([
        () =>
          rpc<RpcJson>(c1, "set_super_admin_status", {
            p_actor_id: sa1Id,
            p_target_id: sa2Id,
            p_new_status: "nonaktif",
          }),
        () =>
          rpc<RpcJson>(c2, "set_super_admin_status", {
            p_actor_id: sa2Id,
            p_target_id: sa1Id,
            p_new_status: "nonaktif",
          }),
      ]);
      const winners = [a, b].filter((r) => !r.error && (r.data as RpcJson)?.ok === true);
      expect(winners).toHaveLength(1);
      const activeCount = await scalar(
        c,
        `select count(*) as n from public.super_admin_accounts where status = 'aktif'`,
      );
      expect(activeCount).toBe(1);
      const deactivatedId = (a.data as RpcJson)?.ok === true ? sa2Id : sa1Id;
      const actorId = deactivatedId === sa1Id ? sa2Id : sa1Id;
      await okVerdict(c, "set_super_admin_status", {
        p_actor_id: actorId,
        p_target_id: deactivatedId,
        p_new_status: "aktif",
      });
    } finally {
      await c1.end().catch(() => undefined);
      await c2.end().catch(() => undefined);
    }
  });

  test("parallel assignment revokes keep >=1 active AM per restaurant, denial audited durably", async () => {
    const c = await db.client();
    await restoreAmState(c);
    const c1 = await freshClient();
    const c2 = await freshClient();
    const [a, b] = await parallel([
      () =>
        rpc<RpcJson>(c1, "revoke_area_manager_assignment", {
          p_actor_id: sa1Id,
          p_am_id: am1Id,
          p_restaurant_id: R1,
        }),
      () =>
        rpc<RpcJson>(c2, "revoke_area_manager_assignment", {
          p_actor_id: sa1Id,
          p_am_id: am2Id,
          p_restaurant_id: R1,
        }),
    ]);
    await c1.end();
    await c2.end();
    const denials = [a, b].filter(
      (r) => !r.error && (r.data as RpcJson)?.error === "LAST_ACTIVE_AREA_MANAGER",
    );
    expect(denials).toHaveLength(1);
    const active = await scalar(
      c,
      `select count(distinct a.area_manager_id)::int as n
       from public.area_manager_assignments a
       join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
       where a.restaurant_id = $1 and a.removed_at is null`,
      [R1],
    );
    expect(active).toBeGreaterThanOrEqual(1);
    const durable = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'assignment.remove' and restaurant_id = $1
         and result = 'denied' and reason = 'last active area manager'`,
      [R1],
    );
    expect(durable).toBe(1);
  });

  test("parallel AM deactivations keep >=1 active AM per restaurant, denial audited durably", async () => {
    const c = await db.client();
    await restoreAmState(c);
    const c1 = await freshClient();
    const c2 = await freshClient();
    try {
      const [a, b] = await parallel([
        () =>
          rpc<RpcJson>(c1, "set_area_manager_status", {
            p_actor_id: sa1Id,
            p_target_id: am1Id,
            p_new_status: "nonaktif",
          }),
        () =>
          rpc<RpcJson>(c2, "set_area_manager_status", {
            p_actor_id: sa1Id,
            p_target_id: am2Id,
            p_new_status: "nonaktif",
          }),
      ]);
      const denials = [a, b].filter(
        (r) => !r.error && (r.data as RpcJson)?.error === "LAST_ACTIVE_AREA_MANAGER",
      );
      expect(denials).toHaveLength(1);
      const active = await scalar(
        c,
        `select count(distinct a.area_manager_id)::int as n
         from public.area_manager_assignments a
         join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
         where a.restaurant_id = $1 and a.removed_at is null`,
        [R1],
      );
      expect(active).toBeGreaterThanOrEqual(1);
      const durable = await scalar(
        c,
        `select count(*) as n from public.admin_audit_log
         where action = 'area_manager.deactivate' and result = 'denied'
           and reason = 'last active area manager of a restaurant'`,
      );
      expect(durable).toBe(1);
    } finally {
      await c1.end().catch(() => undefined);
      await c2.end().catch(() => undefined);
    }
  });

  test("set_area_manager_status on a missing target is NOT_FOUND before any audit", async () => {
    const c = await db.client();
    const ghost = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await expectDenial(
      c,
      "set_area_manager_status",
      { p_actor_id: sa1Id, p_target_id: ghost, p_new_status: "aktif" },
      "NOT_FOUND",
    );
    const audited = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log where target_id = $1`,
      [ghost],
    );
    expect(audited).toBe(0);
  });
});

describe("durable denial audits (review B8)", () => {
  test("last-active Super Admin denial is audited and committed", async () => {
    const c = await db.client();
    await okVerdict(c, "set_super_admin_status", {
      p_actor_id: sa1Id,
      p_target_id: sa2Id,
      p_new_status: "nonaktif",
    });
    const denial = await expectDenial(
      c,
      "set_super_admin_status",
      { p_actor_id: sa1Id, p_target_id: sa1Id, p_new_status: "nonaktif" },
      "LAST_ACTIVE_SUPER_ADMIN",
    );
    expect(denial.ok).toBe(false);
    const durable = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'super_admin.deactivate' and target_id = $1
         and result = 'denied' and reason = 'last active super admin'`,
      [sa1Id],
    );
    expect(durable).toBe(1);
    await okVerdict(c, "set_super_admin_status", {
      p_actor_id: sa1Id,
      p_target_id: sa2Id,
      p_new_status: "aktif",
    });
  });

  test("out-of-scope AM status change is audited durably", async () => {
    const c = await db.client();
    await restoreAmState(c);
    // am2 is assigned only to R1; kasir.restodua lives in R2.
    const r2Manager = await oneText(
      c,
      `select id::text as n from public.manager_accounts where lower(id_manager) = 'kasir.restodua'`,
    );
    await expectDenial(
      c,
      "set_manager_status",
      {
        p_actor_kind: "area_manager",
        p_actor_id: am2Id,
        p_manager_id: r2Manager,
        p_new_status: "nonaktif",
      },
      "NOT_AUTHORIZED",
    );
    const outOfScope = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager.status' and actor_id = $1 and result = 'denied' and reason = 'not authorized'`,
      [am2Id],
    );
    expect(outOfScope).toBeGreaterThanOrEqual(1);
  });

  test("invalid lifecycle transitions are audited durably", async () => {
    const c = await db.client();
    await expectDenial(
      c,
      "set_manager_status",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_manager_id: managerId,
        p_new_status: "paused",
      },
      "INVALID_STATUS",
    );
    const statusAudit = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager.status' and result = 'denied' and reason = 'invalid status'`,
    );
    expect(statusAudit).toBe(1);
    await expectDenial(
      c,
      "set_area_manager_status",
      { p_actor_id: sa1Id, p_target_id: am1Id, p_new_status: "archived" },
      "INVALID_STATUS",
    );
    const amAudit = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'area_manager.status' and result = 'denied' and reason = 'invalid status'`,
    );
    expect(amAudit).toBe(1);
  });

  test("duplicate pending reset is audited durably as a failed attempt", async () => {
    const c = await db.client();
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [managerId]);
    const before = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager_reset.submit' and result = 'failed' and reason = 'already pending'`,
    );
    expect(
      await submitResetOk(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: await scryptHash("DupPending#1"),
      }),
    ).toBe(true);
    const second = await submitResetOk(c, "submit_manager_reset_request", {
      p_staff_id: "kasir.satgas01",
      p_candidate_hash: await scryptHash("DupPending#1"),
    });
    expect(second).toBe(false);
    const after = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager_reset.submit' and result = 'failed' and reason = 'already pending'`,
    );
    expect(after).toBe(before + 1);
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [managerId]);
  });

  test("same reservation idempotently reconciles a committed reset request", async () => {
    const c = await db.client();
    const resetManagerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [
      resetManagerId,
    ]);
    const reservation = await rpcRows<{ reservation_id: string }>(
      c,
      "reserve_owner_login_attempt",
      {
        p_client_bucket_hash: "c".repeat(64),
        p_ip_bucket_hash: "d".repeat(64),
        p_attempt_key: "reset-response-loss-attempt",
      },
    );
    const reservationId = reservation.rows[0]?.reservation_id;
    expect(reservation.error).toBeNull();
    expect(reservationId).toBeTruthy();

    const first = await rpc<boolean>(c, "submit_manager_reset_request", {
      p_staff_id: "budi.santoso",
      p_candidate_hash: await scryptHash("ResetAttempt#1"),
      p_reservation_id: reservationId,
    });
    const retry = await rpc<boolean>(c, "submit_manager_reset_request", {
      p_staff_id: "budi.santoso",
      p_candidate_hash: await scryptHash("ResetAttempt#1"),
      p_reservation_id: reservationId,
    });
    expect(first).toEqual({ data: true, error: null });
    expect(retry).toEqual({ data: true, error: null });
    expect(
      await oneText(
        c,
        `select coalesce(outcome, 'pending') as n
         from public.owner_login_rate_limit_reservations where id = $1`,
        [reservationId],
      ),
    ).toBe("succeeded");

    const rows = await c.query(
      `select count(*)::int as n from public.manager_reset_requests
       where manager_id = $1 and reservation_id = $2`,
      [resetManagerId, reservationId],
    );
    expect(rows.rows[0]?.n).toBe(1);
    const ledger = await c.query(
      `select request_kind, staff_id, result, request_id::text as request_id
       from public.staff_reset_attempts where reservation_id = $1`,
      [reservationId],
    );
    expect(ledger.rows).toEqual([
      expect.objectContaining({
        request_kind: "manager",
        staff_id: "budi.santoso",
        result: true,
        request_id: expect.any(String),
      }),
    ]);
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [
      resetManagerId,
    ]);
  });

  test("same reservation idempotently reconciles a committed AM reset request", async () => {
    const c = await db.client();
    const resetAmId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    await c.query(
      `insert into public.area_manager_accounts
         (id, staff_id, full_name, password_hash, status)
       values ($1, 'am.reset.idem', 'AM Reset Idempotency', 'salt:hash', 'aktif')
       on conflict (id) do update set status = 'aktif'`,
      [resetAmId],
    );
    await c.query(`delete from public.am_reset_requests where area_manager_id = $1`, [resetAmId]);
    const reservation = await rpcRows<{ reservation_id: string }>(
      c,
      "reserve_owner_login_attempt",
      {
        p_client_bucket_hash: "e".repeat(64),
        p_ip_bucket_hash: "f".repeat(64),
        p_attempt_key: "am-reset-response-loss-attempt",
      },
    );
    const reservationId = reservation.rows[0]?.reservation_id;
    expect(reservation.error).toBeNull();
    expect(reservationId).toBeTruthy();

    const first = await rpc<boolean>(c, "submit_am_reset_request", {
      p_staff_id: "am.reset.idem",
      p_candidate_hash: await scryptHash("ResetAttempt#2"),
      p_reservation_id: reservationId,
    });
    const retry = await rpc<boolean>(c, "submit_am_reset_request", {
      p_staff_id: "am.reset.idem",
      p_candidate_hash: await scryptHash("ResetAttempt#2"),
      p_reservation_id: reservationId,
    });
    expect(first).toEqual({ data: true, error: null });
    expect(retry).toEqual({ data: true, error: null });
    expect(
      await oneText(
        c,
        `select coalesce(outcome, 'pending') as n
         from public.owner_login_rate_limit_reservations where id = $1`,
        [reservationId],
      ),
    ).toBe("succeeded");

    const rows = await c.query(
      `select count(*)::int as n from public.am_reset_requests
       where area_manager_id = $1 and reservation_id = $2`,
      [resetAmId, reservationId],
    );
    expect(rows.rows[0]?.n).toBe(1);
    const ledger = await c.query(
      `select request_kind, staff_id, result, request_id::text as request_id
       from public.staff_reset_attempts where reservation_id = $1`,
      [reservationId],
    );
    expect(ledger.rows).toEqual([
      expect.objectContaining({
        request_kind: "area_manager",
        staff_id: "am.reset.idem",
        result: true,
        request_id: expect.any(String),
      }),
    ]);
    await c.query(`delete from public.area_manager_accounts where id = $1`, [resetAmId]);
  });

  test("denial audits never carry secrets or candidate hashes in metadata", async () => {
    const c = await db.client();
    const withSecrets = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where metadata::text ~ 'candidate_hash|password_hash|token'`,
    );
    expect(withSecrets).toBe(0);
  });
});

describe("atomic Manager/AM reset reservation binding", () => {
  const atomicAmId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
  const atomicManagerId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

  async function ensureAtomicResetActors(c: Client): Promise<void> {
    await c.query(
      `insert into public.area_manager_accounts
         (id, staff_id, full_name, password_hash, status)
       values ($1, 'atomic.reset.am', 'Atomic Reset AM', 'salt:hash', 'aktif')
       on conflict (id) do update set status = 'aktif'`,
      [atomicAmId],
    );
    await c.query(
      `insert into public.manager_accounts
         (id, id_manager, full_name, restaurant_id, password_hash, status)
       values ($1, 'atomic.reset.other', 'Atomic Reset Manager', $2, 'salt:hash', 'aktif')
       on conflict (id) do update set status = 'aktif'`,
      [atomicManagerId, R1],
    );
  }

  test("a definitive failure is charged and ledgered exactly once across replay", async () => {
    const c = await db.client();
    const { reservationId, clientHash, ipHash } = await reserveResetAttempt(
      c,
      "reset-failure-once",
    );
    const beforeAudit = await scalar(
      c,
      `select count(*) from public.admin_audit_log
       where action = 'manager_reset.submit' and reason = 'unknown or inactive account'`,
    );
    const params = {
      p_staff_id: "missing.reset.identity",
      p_candidate_hash: await scryptHash("MissingReset#1"),
      p_reservation_id: reservationId,
    };
    expect(await rpc<boolean>(c, "submit_manager_reset_request", params)).toEqual({
      data: false,
      error: null,
    });
    expect(await rpc<boolean>(c, "submit_manager_reset_request", params)).toEqual({
      data: false,
      error: null,
    });
    const terminal = await c.query(
      `select outcome, consumed_at is not null as consumed
       from public.owner_login_rate_limit_reservations where id = $1`,
      [reservationId],
    );
    expect(terminal.rows).toEqual([{ outcome: "failed", consumed: true }]);
    expect(
      await scalar(
        c,
        `select count(*) from public.staff_reset_attempts
         where reservation_id = $1 and request_kind = 'manager'
           and staff_id = 'missing.reset.identity' and result = false
           and request_id is null`,
        [reservationId],
      ),
    ).toBe(1);
    const buckets = await c.query(
      `select bucket_hash, failures from public.owner_login_rate_limit_buckets
       where bucket_hash in ($1, $2) order by bucket_hash`,
      [clientHash, ipHash],
    );
    expect(buckets.rows).toEqual([
      { bucket_hash: [clientHash, ipHash].sort()[0], failures: 1 },
      { bucket_hash: [clientHash, ipHash].sort()[1], failures: 1 },
    ]);
    expect(
      await scalar(
        c,
        `select count(*) from public.admin_audit_log
         where action = 'manager_reset.submit' and reason = 'unknown or inactive account'`,
      ),
    ).toBe(beforeAudit + 1);
  });

  test("reset row, immutable ledger, audit, and limiter terminal update roll back together", async () => {
    const c = await db.client();
    const resetManagerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [
      resetManagerId,
    ]);
    const { reservationId } = await reserveResetAttempt(c, "reset-terminal-throws");
    const beforeAudit = await scalar(
      c,
      `select count(*) from public.admin_audit_log where action = 'manager_reset.submit'`,
    );
    await c.query(`create function pg_temp.raise_reset_terminal_update()
      returns trigger language plpgsql as $$ begin
        raise exception 'forced terminal limiter update failure';
      end $$`);
    await c.query(`create trigger force_reset_terminal_update
      before update on public.owner_login_rate_limit_reservations
      for each row when (old.id = '${reservationId}'::uuid)
      execute function pg_temp.raise_reset_terminal_update()`);
    const result = await rpc<boolean>(c, "submit_manager_reset_request", {
      p_staff_id: "budi.santoso",
      p_candidate_hash: await scryptHash("RollbackReset#1"),
      p_reservation_id: reservationId,
    });
    await c.query(
      `drop trigger force_reset_terminal_update on public.owner_login_rate_limit_reservations`,
    );
    expect(result.error).toContain("forced terminal limiter update failure");
    expect(
      await scalar(
        c,
        `select count(*) from public.manager_reset_requests where reservation_id = $1`,
        [reservationId],
      ),
    ).toBe(0);
    expect(
      await scalar(
        c,
        `select count(*) from public.staff_reset_attempts where reservation_id = $1`,
        [reservationId],
      ),
    ).toBe(0);
    const reservation = await c.query(
      `select consumed_at, outcome from public.owner_login_rate_limit_reservations where id = $1`,
      [reservationId],
    );
    expect(reservation.rows).toEqual([{ consumed_at: null, outcome: null }]);
    expect(
      await scalar(
        c,
        `select count(*) from public.admin_audit_log where action = 'manager_reset.submit'`,
      ),
    ).toBe(beforeAudit);
  });

  test("one raw reservation globally binds cross-role contenders in deterministic FIFO order", async () => {
    const observer = await db.client();
    await observer.query(`delete from public.manager_reset_requests where manager_id = $1`, [
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    ]);
    await ensureAtomicResetActors(observer);
    await observer.query(`delete from public.am_reset_requests where area_manager_id = $1`, [
      atomicAmId,
    ]);
    const { reservationId } = await reserveResetAttempt(observer, "reset-cross-role-race");
    const holder = await freshClient();
    const manager = await freshClient();
    const areaManager = await freshClient();
    await manager.query(`set application_name = 'reset-cross-role-manager'`);
    await areaManager.query(`set application_name = 'reset-cross-role-am'`);
    await holder.query("begin");
    await holder.query(
      `select 1 from public.owner_login_rate_limit_reservations where id = $1 for update`,
      [reservationId],
    );
    try {
      const managerCall = rpc<boolean>(manager, "submit_manager_reset_request", {
        p_staff_id: "budi.santoso",
        p_candidate_hash: await scryptHash("CrossRoleReset#1"),
        p_reservation_id: reservationId,
      });
      await waitForLockWait(observer, "reset-cross-role-manager");
      const amCall = rpc<boolean>(areaManager, "submit_am_reset_request", {
        p_staff_id: "atomic.reset.am",
        p_candidate_hash: await scryptHash("CrossRoleReset#2"),
        p_reservation_id: reservationId,
      });
      await waitForLockWait(observer, "reset-cross-role-am");
      await holder.query("commit");
      expect(await managerCall).toEqual({ data: true, error: null });
      expect(await amCall).toEqual({ data: false, error: null });
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
      await manager.end();
      await areaManager.end();
    }
    expect(
      await scalar(
        observer,
        `select count(*) from public.staff_reset_attempts where reservation_id = $1`,
        [reservationId],
      ),
    ).toBe(1);
    expect(
      await scalar(
        observer,
        `select count(*) from public.staff_reset_attempts
         where reservation_id = $1 and request_kind = 'manager' and staff_id = 'budi.santoso'`,
        [reservationId],
      ),
    ).toBe(1);
  });

  test("one raw reservation globally binds cross-staff contenders in deterministic FIFO order", async () => {
    const observer = await db.client();
    await ensureAtomicResetActors(observer);
    await observer.query(
      `delete from public.manager_reset_requests
       where manager_id in ($1, $2)`,
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", atomicManagerId],
    );
    const { reservationId } = await reserveResetAttempt(observer, "reset-cross-staff-race");
    const holder = await freshClient();
    const first = await freshClient();
    const second = await freshClient();
    await first.query(`set application_name = 'reset-cross-staff-first'`);
    await second.query(`set application_name = 'reset-cross-staff-second'`);
    await holder.query("begin");
    await holder.query(
      `select 1 from public.owner_login_rate_limit_reservations where id = $1 for update`,
      [reservationId],
    );
    try {
      const firstCall = rpc<boolean>(first, "submit_manager_reset_request", {
        p_staff_id: "budi.santoso",
        p_candidate_hash: await scryptHash("CrossStaffReset#1"),
        p_reservation_id: reservationId,
      });
      await waitForLockWait(observer, "reset-cross-staff-first");
      const secondCall = rpc<boolean>(second, "submit_manager_reset_request", {
        p_staff_id: "atomic.reset.other",
        p_candidate_hash: await scryptHash("CrossStaffReset#2"),
        p_reservation_id: reservationId,
      });
      await waitForLockWait(observer, "reset-cross-staff-second");
      await holder.query("commit");
      expect(await firstCall).toEqual({ data: true, error: null });
      expect(await secondCall).toEqual({ data: false, error: null });
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
      await first.end();
      await second.end();
    }
    const ledger = await observer.query(
      `select request_kind, staff_id, result from public.staff_reset_attempts where reservation_id = $1`,
      [reservationId],
    );
    expect(ledger.rows).toEqual([
      { request_kind: "manager", staff_id: "budi.santoso", result: true },
    ]);
  });

  test("expiry is revalidated with wall clock after waiting on the account lock", async () => {
    const observer = await db.client();
    const resetManagerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    await observer.query(`delete from public.manager_reset_requests where manager_id = $1`, [
      resetManagerId,
    ]);
    const { reservationId } = await reserveResetAttempt(observer, "reset-expires-after-wait");
    await observer.query(
      `update public.owner_login_rate_limit_reservations
       set expires_at = clock_timestamp() + interval '500 milliseconds' where id = $1`,
      [reservationId],
    );
    const holder = await freshClient();
    const contender = await freshClient();
    await contender.query(`set application_name = 'reset-expiry-account-wait'`);
    await holder.query("begin");
    await holder.query(`select 1 from public.manager_accounts where id = $1 for update`, [
      resetManagerId,
    ]);
    try {
      const call = rpc<boolean>(contender, "submit_manager_reset_request", {
        p_staff_id: "budi.santoso",
        p_candidate_hash: await scryptHash("ExpiryReset#1"),
        p_reservation_id: reservationId,
      });
      await waitForLockWait(observer, "reset-expiry-account-wait");
      await sleep(650);
      await holder.query("commit");
      expect(await call).toEqual({ data: false, error: null });
    } finally {
      await holder.query("rollback").catch(() => undefined);
      await holder.end();
      await contender.end();
    }
    expect(
      await scalar(
        observer,
        `select count(*) from public.manager_reset_requests where reservation_id = $1`,
        [reservationId],
      ),
    ).toBe(0);
    expect(
      await scalar(
        observer,
        `select count(*) from public.staff_reset_attempts where reservation_id = $1`,
        [reservationId],
      ),
    ).toBe(0);
    const state = await observer.query(
      `select consumed_at, outcome from public.owner_login_rate_limit_reservations where id = $1`,
      [reservationId],
    );
    expect(state.rows).toEqual([{ consumed_at: null, outcome: null }]);
  });

  test("run_owner_retention removes old reset ledgers in a bounded batch and preserves recent rows", async () => {
    const c = await db.client();
    const clientHash = sha256Hex("reset-retention-client");
    const ipHash = sha256Hex("reset-retention-ip");
    await c.query(
      `insert into public.owner_login_rate_limit_buckets(bucket_hash)
       values ($1), ($2) on conflict do nothing`,
      [clientHash, ipHash],
    );
    await c.query(
      `with inserted as (
         insert into public.owner_login_rate_limit_reservations
           (id, client_bucket_hash, ip_bucket_hash, client_sequence, ip_sequence,
            expires_at, consumed_at, attempt_key, outcome)
         select gen_random_uuid(), $1, $2, n, n,
                clock_timestamp() - interval '3 days', clock_timestamp() - interval '3 days',
                'reset-retention-old-' || n::text, 'failed'
         from generate_series(1, 501) n
         returning id, attempt_key
       )
       insert into public.staff_reset_attempts
         (reservation_id, request_kind, staff_id, result, created_at)
       select id, 'manager', 'retention-' || attempt_key, false,
              clock_timestamp() - interval '3 days'
       from inserted`,
      [clientHash, ipHash],
    );
    const { reservationId } = await reserveResetAttempt(c, "reset-retention-recent");
    expect(
      await rpc<boolean>(c, "submit_manager_reset_request", {
        p_staff_id: "missing.retention.recent",
        p_candidate_hash: await scryptHash("RetentionReset#1"),
        p_reservation_id: reservationId,
      }),
    ).toEqual({ data: false, error: null });
    const first = await rpcOk<Record<string, unknown>>(c, "run_owner_retention", {});
    expect(first).toMatchObject({ staff_reset_attempts: { attempts_deleted: 500 } });
    expect(
      await scalar(
        c,
        `select count(*) from public.staff_reset_attempts where staff_id like 'retention-reset-retention-old-%'`,
      ),
    ).toBe(1);
    expect(
      await scalar(
        c,
        `select count(*) from public.staff_reset_attempts where reservation_id = $1`,
        [reservationId],
      ),
    ).toBe(1);
    const second = await rpcOk<Record<string, unknown>>(c, "run_owner_retention", {});
    expect(second).toMatchObject({ staff_reset_attempts: { attempts_deleted: 1 } });
    expect(
      await scalar(
        c,
        `select count(*) from public.staff_reset_attempts where staff_id like 'retention-reset-retention-old-%'`,
      ),
    ).toBe(0);
  });

  test("success-path retention preserves Manager and AM reset rows while clearing bindings", async () => {
    const c = await db.client();
    const managerActorId = atomicManagerId;
    const amActorId = atomicAmId;
    const reservationIds: string[] = [];
    let managerRequestId = "";
    let amRequestId = "";

    try {
      await ensureAtomicResetActors(c);
      await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [
        managerActorId,
      ]);
      await c.query(`delete from public.am_reset_requests where area_manager_id = $1`, [amActorId]);

      const managerReservation = await reserveResetAttempt(c, "reset-retention-success-manager");
      reservationIds.push(managerReservation.reservationId);
      expect(
        await rpc<boolean>(c, "submit_manager_reset_request", {
          p_staff_id: "atomic.reset.other",
          p_candidate_hash: await scryptHash("RetentionSuccessManager#1"),
          p_reservation_id: managerReservation.reservationId,
        }),
      ).toEqual({ data: true, error: null });
      managerRequestId = await oneText(
        c,
        `select id::text from public.manager_reset_requests where reservation_id = $1`,
        [managerReservation.reservationId],
      );

      const amReservation = await reserveResetAttempt(c, "reset-retention-success-am");
      reservationIds.push(amReservation.reservationId);
      expect(
        await rpc<boolean>(c, "submit_am_reset_request", {
          p_staff_id: "atomic.reset.am",
          p_candidate_hash: await scryptHash("RetentionSuccessAm#1"),
          p_reservation_id: amReservation.reservationId,
        }),
      ).toEqual({ data: true, error: null });
      amRequestId = await oneText(
        c,
        `select id::text from public.am_reset_requests where reservation_id = $1`,
        [amReservation.reservationId],
      );

      // The immutable ledger is aged only as test scaffolding; both business
      // rows were created through the production RPCs above.
      await c.query(
        `alter table public.staff_reset_attempts disable trigger staff_reset_attempts_immutable`,
      );
      try {
        await c.query(
          `update public.staff_reset_attempts
           set created_at = clock_timestamp() - interval '3 days'
           where reservation_id = any($1::uuid[])`,
          [reservationIds],
        );
      } finally {
        await c.query(
          `alter table public.staff_reset_attempts enable trigger staff_reset_attempts_immutable`,
        );
      }
      await c.query(
        `update public.owner_login_rate_limit_reservations
         set consumed_at = clock_timestamp() - interval '3 days',
             expires_at = clock_timestamp() - interval '3 days'
         where id = any($1::uuid[])`,
        [reservationIds],
      );

      const retention = await rpc<Record<string, unknown>>(c, "run_owner_retention", {});
      expect(retention.error).toBeNull();
      expect(retention.data).toEqual(expect.any(Object));

      expect(
        await c.query(
          `select id::text as id, reservation_id::text as reservation_id, status
           from public.manager_reset_requests where id = $1`,
          [managerRequestId],
        ),
      ).toMatchObject({
        rows: [{ id: managerRequestId, reservation_id: null, status: "pending" }],
      });
      expect(
        await c.query(
          `select id::text as id, reservation_id::text as reservation_id, status
           from public.am_reset_requests where id = $1`,
          [amRequestId],
        ),
      ).toMatchObject({ rows: [{ id: amRequestId, reservation_id: null, status: "pending" }] });
      expect(
        await scalar(
          c,
          `select count(*) from public.staff_reset_attempts
           where reservation_id = any($1::uuid[])`,
          [reservationIds],
        ),
      ).toBe(0);
      expect(
        await scalar(
          c,
          `select count(*) from public.owner_login_rate_limit_reservations
           where id = any($1::uuid[])`,
          [reservationIds],
        ),
      ).toBe(0);
    } finally {
      await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [
        managerActorId,
      ]);
      await c.query(`delete from public.am_reset_requests where area_manager_id = $1`, [amActorId]);
      if (reservationIds.length > 0) {
        await c.query(
          `delete from public.staff_reset_attempts where reservation_id = any($1::uuid[])`,
          [reservationIds],
        );
        await c.query(
          `delete from public.owner_login_rate_limit_reservations where id = any($1::uuid[])`,
          [reservationIds],
        );
      }
    }
  });

  test("legacy reset overloads are absent and reset ledger is immutable and not directly exposed", async () => {
    const c = await db.client();
    await c.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'p2_probe') then
        create role p2_probe;
      end if;
    end $$`);
    await expect(
      c.query(`update public.staff_reset_attempts set staff_id = staff_id where reservation_id = (
        select reservation_id from public.staff_reset_attempts limit 1
      )`),
    ).rejects.toThrow(/immutable/i);
    expect(
      await scalar(
        c,
        `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.oid in (
           to_regprocedure('public.submit_manager_reset_request(text,text)'),
           to_regprocedure('public.submit_am_reset_request(text,text)')
         )`,
      ),
    ).toBe(0);
    for (const role of ["anon", "authenticated", "p2_probe"]) {
      expect(
        await scalar(
          c,
          `select has_table_privilege($1, 'public.staff_reset_attempts', 'select,insert,update,delete')::int`,
          [role],
        ),
      ).toBe(0);
    }
    const defs = await c.query(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname in ('submit_manager_reset_request', 'submit_am_reset_request',
                           'reconcile_staff_reset_attempt', 'cleanup_staff_reset_attempts')
       order by p.proname`,
    );
    expect(defs.rows).toHaveLength(4);
    expect(defs.rows.every((row) => row.prosecdef === true)).toBe(true);
    expect(
      defs.rows.every((row) => row.proconfig?.includes("search_path=pg_catalog, public")),
    ).toBe(true);
  });
});

describe("Super Admin change-password RPC (review A1)", () => {
  test("set_staff_password swaps hash, stamps password_changed_at, revokes all sessions", async () => {
    const c = await db.client();
    const oldHash = await scryptHash("Lama#Rahasia1");
    const newHash = await scryptHash("Baru#Rahasia2");
    await okVerdict(c, "set_staff_password", {
      p_kind: "super_admin",
      p_account_id: sa1Id,
      p_password_hash: oldHash,
    });
    // A fresh session exists BEFORE the change and must be gone AFTER it.
    const liveToken = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "super_admin",
      p_account_id: sa1Id,
    });
    const stampedAt = (
      await c.query(`select password_changed_at from public.super_admin_accounts where id = $1`, [
        sa1Id,
      ])
    ).rows[0].password_changed_at;
    expect(stampedAt).not.toBeNull();
    await okVerdict(c, "set_staff_password", {
      p_kind: "super_admin",
      p_account_id: sa1Id,
      p_password_hash: newHash,
    });
    const row = (
      await c.query(
        `select password_hash, password_changed_at > $2 as advanced
         from public.super_admin_accounts where id = $1`,
        [sa1Id, stampedAt],
      )
    ).rows[0];
    expect(String(row.password_hash)).toBe(newHash);
    expect(row.advanced).toBe(true);
    const sessions = await scalar(
      c,
      `select count(*) as n from public.staff_sessions
       where session_kind = 'super_admin' and account_id = $1`,
      [sa1Id],
    );
    expect(sessions).toBe(0);
    // The OLD password no longer verifies; the NEW one does (login gate).
    expect(await verifyManagerPassword("Lama#Rahasia1", String(row.password_hash))).toBe(false);
    expect(await verifyManagerPassword("Baru#Rahasia2", String(row.password_hash))).toBe(true);
    // ...and the stale bearer is dead against the session gate.
    const dead = await rpcOk<unknown>(c, "get_staff_session", {
      p_kind: "super_admin",
      p_token: liveToken,
    });
    expect(dead).toBeNull();
  });

  test("set_staff_password on an inactive account is a durable denial without hash swap", async () => {
    const c = await db.client();
    const hashBefore = await oneText(
      c,
      `select password_hash as n from public.super_admin_accounts where id = $1`,
      [sa2Id],
    );
    await okVerdict(c, "set_super_admin_status", {
      p_actor_id: sa1Id,
      p_target_id: sa2Id,
      p_new_status: "nonaktif",
    });
    await expectDenial(
      c,
      "set_staff_password",
      { p_kind: "super_admin", p_account_id: sa2Id, p_password_hash: "attacker:hash" },
      "NOT_AUTHORIZED",
    );
    const hashAfter = await oneText(
      c,
      `select password_hash as n from public.super_admin_accounts where id = $1`,
      [sa2Id],
    );
    expect(hashAfter).toBe(hashBefore);
    const durable = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'password.change' and target_id = $1 and result = 'denied'`,
      [sa2Id],
    );
    expect(durable).toBe(1);
    await okVerdict(c, "set_super_admin_status", {
      p_actor_id: sa1Id,
      p_target_id: sa2Id,
      p_new_status: "aktif",
    });
  });
});

describe("password reset: one-pending, first decision wins, bookkeeping", () => {
  test("duplicate pending rejected; approval flips hash, stamps password_changed_at, revokes sessions", async () => {
    const c = await db.client();
    await restoreAmState(c);
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [managerId]);
    const candidate = await scryptHash("PasswordBaru#1");
    expect(
      await submitResetOk(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: candidate,
      }),
    ).toBe(true);
    expect(
      await submitResetRpc(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: candidate,
      }),
    ).toMatchObject({ data: false });
    const before = await mintActiveManagerSession(c, managerId);
    expect(typeof before).toBe("string");
    const pendingId = await oneText(
      c,
      `select id::text as n from public.manager_reset_requests where manager_id = $1 and status = 'pending'`,
      [managerId],
    );
    await okVerdict(c, "decide_manager_reset", {
      p_decider_kind: "area_manager",
      p_decider_id: am2Id,
      p_request_id: pendingId,
      p_decision: "approved",
    });
    const row = await c.query(
      `select password_hash, password_changed_at from public.manager_accounts where id = $1`,
      [managerId],
    );
    expect(String(row.rows[0].password_hash)).toBe(candidate);
    expect(row.rows[0].password_changed_at).not.toBeNull();
    const sessions = await scalar(
      c,
      `select count(*) as n from public.manager_sessions where manager_id = $1`,
      [managerId],
    );
    expect(sessions).toBe(0);
    // Re-deciding an already decided request is durable as well (B8).
    await expectDenial(
      c,
      "decide_manager_reset",
      {
        p_decider_kind: "area_manager",
        p_decider_id: am2Id,
        p_request_id: pendingId,
        p_decision: "rejected",
      },
      "ALREADY_DECIDED",
    );
    const decided = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'manager_reset.decide' and result = 'failed' and reason = 'already decided'`,
    );
    expect(decided).toBe(1);
  });

  test("Super Admin is not a Manager reset approver; first decision wins under parallelism", async () => {
    const c = await db.client();
    await c.query(`delete from public.manager_reset_requests where manager_id = $1`, [managerId]);
    expect(
      await submitResetOk(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: await scryptHash("PasswordBaru#2"),
      }),
    ).toBe(true);
    const requestId = await oneText(
      c,
      `select id::text as n from public.manager_reset_requests where manager_id = $1 and status = 'pending'`,
      [managerId],
    );
    await expectDenial(
      c,
      "decide_manager_reset",
      {
        p_decider_kind: "super_admin",
        p_decider_id: sa1Id,
        p_request_id: requestId,
        p_decision: "approved",
      },
      "NOT_AUTHORIZED",
    );
    const c1 = await freshClient();
    const c2 = await freshClient();
    const [a, b] = await parallel([
      () =>
        rpc<RpcJson>(c1, "decide_manager_reset", {
          p_decider_kind: "area_manager",
          p_decider_id: am1Id,
          p_request_id: requestId,
          p_decision: "approved",
        }),
      () =>
        rpc<RpcJson>(c2, "decide_manager_reset", {
          p_decider_kind: "area_manager",
          p_decider_id: am2Id,
          p_request_id: requestId,
          p_decision: "rejected",
        }),
    ]);
    await c1.end();
    await c2.end();
    const trueCount = [a, b].filter((r) => !r.error && (r.data as RpcJson)?.ok === true).length;
    expect(trueCount).toBe(1);
  });

  test("AM reset approved by Super Admin stamps password_changed_at and revokes sessions", async () => {
    const c = await db.client();
    await okVerdict(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am1Id,
      p_new_status: "aktif",
    });
    const candidate = await scryptHash("AmNewPass#11");
    expect(
      await submitResetOk(c, "submit_am_reset_request", {
        p_staff_id: "am.satu",
        p_candidate_hash: candidate,
      }),
    ).toBe(true);
    await rpcOk(c, "create_staff_session", { p_kind: "area_manager", p_account_id: am1Id });
    const requestId = await oneText(
      c,
      `select id::text as n from public.am_reset_requests where area_manager_id = $1 and status = 'pending'`,
      [am1Id],
    );
    await okVerdict(c, "decide_am_reset", {
      p_decider_id: sa1Id,
      p_request_id: requestId,
      p_decision: "approved",
    });
    const row = await c.query(
      `select password_changed_at from public.area_manager_accounts where id = $1`,
      [am1Id],
    );
    expect(row.rows[0].password_changed_at).not.toBeNull();
    const sessions = await scalar(
      c,
      `select count(*) as n from public.staff_sessions where session_kind = 'area_manager' and account_id = $1`,
      [am1Id],
    );
    expect(sessions).toBe(0);
  });
});

describe("Super Admin recovery tokens (review B6)", () => {
  async function recoverySetup(): Promise<{ c: Client; raw: string }> {
    const c = await db.client();
    const raw = generateToken();
    await okVerdict(c, "create_super_admin_recovery_token", {
      p_super_admin_id: sa2Id,
      p_token_hash: sha256Hex(raw),
    });
    return { c, raw };
  }

  test("single-use raw token resets password, stamps timestamp, revokes sessions", async () => {
    const { c, raw } = await recoverySetup();
    const beforeHash = await oneText(
      c,
      `select password_hash as n from public.super_admin_accounts where id = $1`,
      [sa2Id],
    );
    await rpcOk(c, "create_staff_session", { p_kind: "super_admin", p_account_id: sa2Id });
    const newHash = await scryptHash("Recovered#123");
    await okVerdict(c, "consume_super_admin_recovery_token", {
      p_super_admin_id: sa2Id,
      p_token: raw,
      p_password_hash: newHash,
    });
    const after = (
      await c.query(
        `select password_hash, password_changed_at from public.super_admin_accounts where id = $1`,
        [sa2Id],
      )
    ).rows[0];
    expect(String(after.password_hash)).not.toBe(beforeHash);
    expect(after.password_changed_at).not.toBeNull();
    expect(String(after.password_hash)).toBe(newHash);
    const sessions = await scalar(
      c,
      `select count(*) as n from public.staff_sessions where session_kind = 'super_admin' and account_id = $1`,
      [sa2Id],
    );
    expect(sessions).toBe(0);
    await expectDenial(
      c,
      "consume_super_admin_recovery_token",
      { p_super_admin_id: sa2Id, p_token: raw, p_password_hash: "x:y" },
      "INVALID_TOKEN",
    );
  });

  test("issuing a NEW recovery token atomically invalidates the previous live one", async () => {
    const { c, raw: first } = await recoverySetup();
    const second = generateToken();
    await okVerdict(c, "create_super_admin_recovery_token", {
      p_super_admin_id: sa2Id,
      p_token_hash: sha256Hex(second),
    });
    await expectDenial(
      c,
      "consume_super_admin_recovery_token",
      { p_super_admin_id: sa2Id, p_token: first, p_password_hash: "x:y" },
      "INVALID_TOKEN",
    );
    await okVerdict(c, "consume_super_admin_recovery_token", {
      p_super_admin_id: sa2Id,
      p_token: second,
      p_password_hash: await scryptHash("SecondWins#1"),
    });
  });

  test("successful consume kills every sibling token of the same account", async () => {
    const c = await db.client();
    // Two live tokens exist only via direct SQL (simulating a pre-fix window).
    const tokenA = generateToken();
    const tokenB = generateToken();
    await c.query(
      `insert into public.super_admin_recovery_tokens (super_admin_id, token_hash, expires_at)
       values ($1, $2, now() + interval '30 minutes'), ($1, $3, now() + interval '30 minutes')`,
      [sa2Id, sha256Hex(tokenA), sha256Hex(tokenB)],
    );
    await okVerdict(c, "consume_super_admin_recovery_token", {
      p_super_admin_id: sa2Id,
      p_token: tokenA,
      p_password_hash: await scryptHash("SiblingsDie#1"),
    });
    const live = await scalar(
      c,
      `select count(*) as n from public.super_admin_recovery_tokens
       where super_admin_id = $1 and used_at is null`,
      [sa2Id],
    );
    expect(live).toBe(0);
    await expectDenial(
      c,
      "consume_super_admin_recovery_token",
      { p_super_admin_id: sa2Id, p_token: tokenB, p_password_hash: "x:y" },
      "INVALID_TOKEN",
    );
  });

  test("two parallel consumes of live sibling tokens: exactly one winner", async () => {
    const c = await db.client();
    const tokenA = generateToken();
    const tokenB = generateToken();
    await c.query(
      `insert into public.super_admin_recovery_tokens (super_admin_id, token_hash, expires_at)
       values ($1, $2, now() + interval '30 minutes'), ($1, $3, now() + interval '30 minutes')`,
      [sa2Id, sha256Hex(tokenA), sha256Hex(tokenB)],
    );
    const c1 = await freshClient();
    const c2 = await freshClient();
    const winnerHash = await scryptHash("RaceWinner#1");
    const loserHash = await scryptHash("RaceLoser#1");
    const [a, b] = await parallel([
      () =>
        rpc<RpcJson>(c1, "consume_super_admin_recovery_token", {
          p_super_admin_id: sa2Id,
          p_token: tokenA,
          p_password_hash: winnerHash,
        }),
      () =>
        rpc<RpcJson>(c2, "consume_super_admin_recovery_token", {
          p_super_admin_id: sa2Id,
          p_token: tokenB,
          p_password_hash: loserHash,
        }),
    ]);
    await c1.end();
    await c2.end();
    const wins = [a, b].filter((r) => !r.error && (r.data as RpcJson)?.ok === true);
    expect(wins).toHaveLength(1);
    const loss = (a.data as RpcJson)?.ok === true ? b : a;
    expect((loss.data as RpcJson).error).toBe("INVALID_TOKEN");
  });

  test("expired tokens are rejected and audited as failed attempts", async () => {
    const c = await db.client();
    const raw = generateToken();
    await c.query(
      `insert into public.super_admin_recovery_tokens (super_admin_id, token_hash, expires_at)
       values ($1, $2, now() - interval '1 minute')`,
      [sa2Id, sha256Hex(raw)],
    );
    await expectDenial(
      c,
      "consume_super_admin_recovery_token",
      { p_super_admin_id: sa2Id, p_token: raw, p_password_hash: "x:y" },
      "INVALID_TOKEN",
    );
    const failed = await scalar(
      c,
      `select count(*) as n from public.admin_audit_log
       where action = 'super_admin.recovery_reset' and result = 'failed'
         and reason = 'invalid recovery token'`,
    );
    expect(failed).toBeGreaterThanOrEqual(1);
  });
});

describe("audit read models: scoped, hash-free", () => {
  test("AM sees scoped manager events incl. reset lifecycle; nothing out of scope; no metadata", async () => {
    const c = await db.client();
    await restoreAmState(c);
    const amView = (
      await rpcRows<Record<string, unknown>>(c, "list_admin_audit_for_actor", {
        p_kind: "area_manager",
        p_actor_id: am1Id,
      })
    ).rows;
    expect(amView.length).toBeGreaterThan(0);
    const actions = amView.map((r) => String(r.action));
    expect(actions).toContain("manager.create");
    expect(actions).toContain("manager_reset.submit");
    for (const row of amView) {
      expect(Object.keys(row)).not.toContain("metadata");
      expect(Object.keys(row)).not.toContain("candidate_hash");
      expect(String(row.restaurant_id ?? "")).not.toBe(R3);
    }
    const saView = (
      await rpcRows<Record<string, unknown>>(c, "list_admin_audit_for_actor", {
        p_kind: "super_admin",
        p_actor_id: sa1Id,
      })
    ).rows;
    const saRestaurants = new Set(saView.map((r) => String(r.restaurant_id ?? "")));
    expect(saRestaurants.has(R3)).toBe(true);
  });
});

describe("realtime isolation for Manager (review C14)", () => {
  test("binder is called with its FINAL named parameter p_session_token", async () => {
    const c = await db.client();
    const user = await oneText(
      c,
      `insert into auth.users (email) values ('named.bind@example.test') returning (id::text) as n`,
    );
    const token = await mintActiveManagerSession(c, managerId);
    const b = await freshClient();
    await b.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    const bound = await rpcNamed<boolean>(b, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: token,
    });
    expect(bound.error).toBeNull();
    expect(bound.data).toBe(true);
    await b.end();
  });

  test("calling the binder with a WRONG parameter name fails (contract guard)", async () => {
    const c = await db.client();
    const token = await mintActiveManagerSession(c, managerId);
    const wrong = await rpcNamed<boolean>(c, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_manager_token: token,
    });
    expect(wrong.error ?? "").toMatch(/parameter .*p_manager_token|does not exist/i);
    expect(wrong.data).toBeNull();
  });

  test("channel authorization is bound to the manager's own restaurant only", async () => {
    const c = await db.client();
    const u1 = await oneText(
      c,
      `insert into auth.users (email) values ('m2.device@example.test') returning (id::text) as n`,
    );
    const u2 = await oneText(
      c,
      `insert into auth.users (email) values ('intruder2@example.test') returning (id::text) as n`,
    );
    const managerToken = await mintActiveManagerSession(c, managerId);

    const b1 = await freshClient();
    await b1.query("select set_config('request.jwt.claim.sub', $1, false)", [u1]);
    const bind1 = await rpcNamed<boolean>(b1, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: managerToken,
    });
    expect(bind1.data).toBe(true);
    expect(
      await rpcOk<boolean>(b1, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R1}`,
      }),
    ).toBe(true);
    expect(
      await rpcOk<boolean>(b1, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R2}`,
      }),
    ).toBe(false);
    // Even with a forged restaurant id in the bind call, a second-restaurant
    // channel never opens for this identity.
    const forged = await rpcNamed<boolean>(b1, "bind_manager_session_realtime", {
      p_restaurant_id: R2,
      p_session_token: managerToken,
    });
    expect(forged.error ?? "").toContain("INVALID_SESSION");
    await b1.end();

    const b2 = await freshClient();
    await b2.query("select set_config('request.jwt.claim.sub', $1, false)", [u2]);
    const stolen = await rpcNamed(b2, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: managerToken,
    });
    expect(stolen.error ?? "").toContain("INVALID_SESSION");
    expect(
      await rpcOk<boolean>(b2, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R1}`,
      }),
    ).toBe(false);
    await b2.end();

    await c.query("insert into realtime.messages (topic, payload) values ($1, '{}'), ($2, '{}')", [
      `table-occupancy:${R1}`,
      `table-occupancy:${R2}`,
    ]);
    const rls = await freshClient();
    await rls.query("begin");
    await rls.query("set local role authenticated");
    await rls.query("select set_config('request.jwt.claim.sub', $1, true)", [u1]);
    await rls.query("select set_config('realtime.topic', $1, true)", [`table-occupancy:${R1}`]);
    const visible = await scalar(
      rls,
      `select count(*) as n from realtime.messages where topic = $1`,
      [`table-occupancy:${R1}`],
    );
    expect(visible).toBe(1);
    await rls.query("select set_config('realtime.topic', $1, true)", [`table-occupancy:${R2}`]);
    const foreign = await scalar(
      rls,
      `select count(*) as n from realtime.messages where topic = $1`,
      [`table-occupancy:${R2}`],
    );
    expect(foreign).toBe(0);
    await rls.query("rollback");
    await rls.end();
  });
});

describe("privilege matrix: every Poin 2 SECURITY DEFINER function (review B5)", () => {
  const SERVICE_ONLY: string[] = [
    "write_admin_audit(text,uuid,text,text,text,uuid,uuid,text,text,jsonb)",
    "normalize_staff_id(text)",
    "staff_id_is_valid(text)",
    "claim_staff_id(text,text,uuid)",
    "lock_staff_id_claim(text)",
    "create_staff_session(text,uuid)",
    "get_staff_session(text,text)",
    "revoke_staff_sessions(text,uuid)",
    "revoke_manager_sessions(uuid)",
    "get_manager_id_by_token(text)",
    "get_super_admin_credential_by_id(uuid)",
    "get_area_manager_credential_by_id(uuid)",
    "get_manager_credential_by_id(uuid)",
    "get_super_admin_credential(text)",
    "get_manager_credential(text)",
    "bootstrap_super_admin_state()",
    "bootstrap_create_super_admin(text,text,text,text)",
    "create_super_admin_invite(text,text,text,text,uuid)",
    "resend_super_admin_invite(uuid,text,uuid)",
    "cancel_super_admin_invite(uuid,uuid)",
    "accept_super_admin_invite(text,text,text)",
    "create_super_admin_recovery_token(uuid,text)",
    "consume_super_admin_recovery_token(uuid,text,text)",
    "set_super_admin_status(uuid,uuid,text)",
    "update_staff_profile(text,uuid,text,uuid,text)",
    "set_staff_password(text,uuid,text)",
    "assign_area_manager(uuid,uuid,uuid)",
    "revoke_area_manager_assignment(uuid,uuid,uuid)",
    "list_restaurants_without_active_am()",
    "get_am_rollout_readiness()",
    "get_area_manager_credential(text)",
    "create_area_manager(uuid,text,text,text)",
    "set_area_manager_status(uuid,uuid,text)",
    "actor_can_manage_restaurant(text,uuid,uuid)",
    "create_manager_account(text,uuid,text,text,uuid,text)",
    "set_manager_status(text,uuid,uuid,text)",
    "submit_manager_reset_request(text,text,uuid)",
    "submit_am_reset_request(text,text,uuid)",
    "reconcile_staff_reset_attempt(text,text)",
    "cleanup_staff_reset_attempts()",
    "decide_manager_reset(text,uuid,uuid,text)",
    "decide_am_reset(uuid,uuid,text)",
    "list_am_scope_restaurants(uuid)",
    "list_managers_for_scope(uuid)",
    "list_pending_manager_resets(uuid)",
    "list_pending_am_resets()",
    "get_manager_reset_requester_scope(uuid,uuid)",
    "list_admin_audit_for_actor(text,uuid)",
    "revoke_staff_session_by_token(text,text)",
    "revoke_manager_session_by_token(text)",
  ];
  const BROWSER_BOUND: string[] = [
    "bind_role_session_realtime(uuid,text)",
    "bind_manager_session_realtime(uuid,text)",
  ];

  test("no Poin 2 function is executable by anon/authenticated/a fresh PUBLIC role", async () => {
    const c = await db.client();
    await c.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'p2_probe') then
        create role p2_probe;
      end if;
    end $$`);
    for (const sig of SERVICE_ONLY) {
      for (const role of ["anon", "authenticated", "p2_probe"]) {
        expect(
          await scalar(
            c,
            `select has_function_privilege('${role}', 'public.${sig}', 'execute')::int as n`,
          ),
          `public.${sig} must not be executable by ${role}`,
        ).toBe(0);
      }
      expect(
        await scalar(
          c,
          `select has_function_privilege('service_role', 'public.${sig}', 'execute')::int as n`,
        ),
        `public.${sig} must be executable by service_role`,
      ).toBe(1);
    }
    for (const sig of BROWSER_BOUND) {
      expect(
        await scalar(
          c,
          `select has_function_privilege('anon', 'public.${sig}', 'execute')::int as n`,
        ),
      ).toBe(0);
      expect(
        await scalar(
          c,
          `select has_function_privilege('p2_probe', 'public.${sig}', 'execute')::int as n`,
        ),
      ).toBe(0);
      expect(
        await scalar(
          c,
          `select has_function_privilege('authenticated', 'public.${sig}', 'execute')::int as n`,
        ),
        `public.${sig} is the browser channel binder`,
      ).toBe(1);
    }
  });

  test("every SECURITY DEFINER Poin 2 function pins its search_path", async () => {
    const c = await db.client();
    const names = [...SERVICE_ONLY, ...BROWSER_BOUND].map((s) => s.split("(")[0]);
    const missing = await c.query(
      `select p.proname as n from pg_proc p
       join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.prosecdef
         and p.proname = any($1::text[])
         and (p.proconfig is null or not exists (
           select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
         ))`,
      [[...new Set(names)]],
    );
    expect(missing.rows.map((r) => r.n)).toEqual([]);
  });

  test("audit log stays append-only even for service_role", async () => {
    const c = await db.client();
    expect(
      await scalar(
        c,
        `select has_table_privilege('service_role', 'public.admin_audit_log', 'update')::int as n`,
      ),
    ).toBe(0);
    expect(
      await scalar(
        c,
        `select has_table_privilege('service_role', 'public.admin_audit_log', 'delete')::int as n`,
      ),
    ).toBe(0);
  });
});

describe("AM rollout readiness gate (review B10)", () => {
  test("readiness reports not-ready while a restaurant lacks an active AM", async () => {
    const c = await db.client();
    await restoreAmState(c);
    const state = (await rpcOk<Record<string, unknown>>(c, "get_am_rollout_readiness", {})) as {
      restaurants_total: number;
      restaurants_covered: number;
      uncovered: Array<{ restaurant_id: string; display_name: string }>;
    };
    expect(Number(state.restaurants_total)).toBe(3);
    expect(state.uncovered.map((u) => String(u.restaurant_id))).toContain(R3);
    // R3 has only a Manager (created by SA), no AM assignment yet.
    expect(Number(state.restaurants_covered)).toBe(2);
  });

  test("readiness flips to ready once every active restaurant has an active AM", async () => {
    const c = await db.client();
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R3,
    });
    const state = (await rpcOk<Record<string, unknown>>(c, "get_am_rollout_readiness", {})) as {
      restaurants_total: number;
      restaurants_covered: number;
      uncovered: unknown[];
    };
    expect(Number(state.restaurants_total)).toBe(3);
    expect(Number(state.restaurants_covered)).toBe(3);
    expect(state.uncovered).toHaveLength(0);
  });
});

// --- ROUND 3 (R3-A/E/F/G): DB-level evidence ---------------------------------

describe("R3-A: single-session revocation by raw token", () => {
  test("revoking a staff session kills exactly that session (idempotent)", async () => {
    const c = await db.client();
    const t1 = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "super_admin",
      p_account_id: sa1Id,
    });
    const t2 = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "super_admin",
      p_account_id: sa1Id,
    });
    expect(
      await rpcOk<string | null>(c, "get_staff_session", { p_kind: "super_admin", p_token: t1 }),
    ).toBe(sa1Id);
    expect(
      (
        await rpcOk<{ verdict: string }>(c, "revoke_staff_session_by_token", {
          p_kind: "super_admin",
          p_token: t1,
        })
      ).verdict,
    ).toBe("REVOKED");
    expect(
      await rpcOk<string | null>(c, "get_staff_session", { p_kind: "super_admin", p_token: t1 }),
    ).toBeNull();
    // Single-row scope: a sibling session of the SAME account survives.
    expect(
      await rpcOk<string | null>(c, "get_staff_session", { p_kind: "super_admin", p_token: t2 }),
    ).toBe(sa1Id);
    // Idempotent: a second revoke reports the tombstone-proven verdict.
    expect(
      (
        await rpcOk<{ verdict: string }>(c, "revoke_staff_session_by_token", {
          p_kind: "super_admin",
          p_token: t1,
        })
      ).verdict,
    ).toBe("ALREADY_INACTIVE");
    await rpcOk<{ verdict: string }>(c, "revoke_staff_session_by_token", {
      p_kind: "super_admin",
      p_token: t2,
    });
  });

  test("kind mismatch and junk tokens never revoke anything", async () => {
    const c = await db.client();
    const t = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am1Id,
    });
    expect(
      (
        await rpcOk<{ verdict: string }>(c, "revoke_staff_session_by_token", {
          p_kind: "super_admin",
          p_token: t,
        })
      ).verdict,
    ).toBe("KIND_MISMATCH");
    expect(
      await rpcOk<string | null>(c, "get_staff_session", { p_kind: "area_manager", p_token: t }),
    ).toBe(am1Id);
    expect(
      (
        await rpcOk<{ verdict: string }>(c, "revoke_staff_session_by_token", {
          p_kind: "area_manager",
          p_token: "junk-token",
        })
      ).verdict,
    ).toBe("UNKNOWN_TOKEN");
    expect(
      (
        await rpcOk<{ verdict: string }>(c, "revoke_staff_session_by_token", {
          p_kind: "area_manager",
          p_token: t,
        })
      ).verdict,
    ).toBe("REVOKED");
    expect(
      await rpcOk<string | null>(c, "get_staff_session", { p_kind: "area_manager", p_token: t }),
    ).toBeNull();
  });

  test("revoking a manager bearer kills it for get_manager_id_by_token (idempotent)", async () => {
    const c = await db.client();
    const t = await mintActiveManagerSession(c, managerId);
    expect(await rpcOk<string | null>(c, "get_manager_id_by_token", { p_token: t })).toBe(
      managerId,
    );
    expect(
      (await rpcOk<{ verdict: string }>(c, "revoke_manager_session_by_token", { p_token: t }))
        .verdict,
    ).toBe("REVOKED");
    expect(await rpcOk<string | null>(c, "get_manager_id_by_token", { p_token: t })).toBeNull();
    expect(
      (await rpcOk<{ verdict: string }>(c, "revoke_manager_session_by_token", { p_token: t }))
        .verdict,
    ).toBe("ALREADY_INACTIVE");
    expect(
      (await rpcOk<{ verdict: string }>(c, "revoke_manager_session_by_token", { p_token: "junk" }))
        .verdict,
    ).toBe("UNKNOWN_TOKEN");
  });

  test("role-switch primitive: old AM cookie + old manager token die, new session stays live", async () => {
    // DB half of the role-switch matrix: whichever order the Node core
    // revokes, these primitives make BOTH old credentials unusable while the
    // newly minted session keeps working.
    const c = await db.client();
    const oldAm = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am1Id,
    });
    const oldMgr = await mintActiveManagerSession(c, managerId);
    const newAm = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am1Id,
    });
    await rpcOk<boolean>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: oldAm,
    });
    await rpcOk<boolean>(c, "revoke_manager_session_by_token", { p_token: oldMgr });
    expect(
      await rpcOk<string | null>(c, "get_staff_session", {
        p_kind: "area_manager",
        p_token: oldAm,
      }),
    ).toBeNull();
    expect(
      await rpcOk<string | null>(c, "get_manager_id_by_token", { p_token: oldMgr }),
    ).toBeNull();
    expect(
      await rpcOk<string | null>(c, "get_staff_session", {
        p_kind: "area_manager",
        p_token: newAm,
      }),
    ).toBe(am1Id);
    await rpcOk<boolean>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: newAm,
    });
  });
});

describe("R3-E: AM status is session-authoritative at the DB level", () => {
  // Executes the exact predicates amStatusCore composes (live bearer ->
  // same account -> active row) against the real database.
  async function amRow(c: Client, accountId: string) {
    const r = await c.query(
      `select staff_id, full_name, password_changed_at from public.area_manager_accounts
       where id = $1 and status = 'aktif'`,
      [accountId],
    );
    return r.rows[0] ?? null;
  }

  test("live bearer + active row: authenticated, reminder until first password change", async () => {
    const c = await db.client();
    // A freshly created AM carries the initial password: no stamp yet.
    const created = await okVerdict(c, "create_area_manager", {
      p_actor_id: sa1Id,
      p_staff_id: "am.tiga",
      p_full_name: "AM Tiga",
      p_password_hash: await scryptHash("AmPass#333"),
    });
    const am3Id = String(created.id);
    const token = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am3Id,
    });
    const live = await rpcOk<string | null>(c, "get_staff_session", {
      p_kind: "area_manager",
      p_token: token,
    });
    expect(live).toBe(am3Id);
    const row = await amRow(c, am3Id);
    expect(row).not.toBeNull();
    // password_changed_at is NULL right after creation => mustRemindPassword true
    expect(row.password_changed_at).toBeNull();
    // After a real password set (the same primitive the reset flow uses),
    // the stamp appears => mustRemindPassword false.
    await rpcOk(c, "set_staff_password", {
      p_kind: "area_manager",
      p_account_id: am3Id,
      p_password_hash: await scryptHash("AmPass#baru3"),
    });
    expect((await amRow(c, am3Id)).password_changed_at).not.toBeNull();
    await rpcOk<boolean>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: token,
    });
  });

  test("revoked bearer: not authenticated even though the cookie pair still exists", async () => {
    const c = await db.client();
    const token = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am1Id,
    });
    await rpcOk<boolean>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: token,
    });
    const live = await rpcOk<string | null>(c, "get_staff_session", {
      p_kind: "area_manager",
      p_token: token,
    });
    expect(live).toBeNull();
  });

  test("deactivated account: not authenticated (row filtered by status='aktif')", async () => {
    const c = await db.client();
    // R3's only AM is am2 after B10; cover R3 with am1 first so the
    // last-active-AM guard permits freeing am2, then restore everything.
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "revoke_area_manager_assignment", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am2Id,
      p_new_status: "nonaktif",
    });
    expect(await amRow(c, am2Id)).toBeNull();
    await okVerdict(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am2Id,
      p_new_status: "aktif",
    });
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "revoke_area_manager_assignment", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R3,
    });
    expect(await amRow(c, am2Id)).not.toBeNull();
  });

  test("bearer of a DIFFERENT account than the cookie claims: not authenticated", async () => {
    const c = await db.client();
    const token = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am1Id,
    });
    const live = await rpcOk<string | null>(c, "get_staff_session", {
      p_kind: "area_manager",
      p_token: token,
    });
    // Cookie claims am2; the bearer maps to am1 => core compares and rejects.
    expect(live === am2Id).toBe(false);
    expect(live).toBe(am1Id);
    await rpcOk<boolean>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: token,
    });
  });
});

describe("R3-F: profile rename matrix (IDs immutable, lifecycle-safe)", () => {
  test("AM renames own profile; staff_id untouched; audit lands", async () => {
    const c = await db.client();
    await okVerdict(c, "update_staff_profile", {
      p_actor_kind: "area_manager",
      p_actor_id: am1Id,
      p_target_kind: "area_manager",
      p_target_id: am1Id,
      p_full_name: "AM Satu Rebrand",
    });
    expect(
      await oneText(c, `select full_name from public.area_manager_accounts where id = $1`, [am1Id]),
    ).toBe("AM Satu Rebrand");
    expect(
      await oneText(c, `select staff_id from public.area_manager_accounts where id = $1`, [am1Id]),
    ).toBe("am.satu");
    expect(
      await scalar(
        c,
        `select count(*) as n from public.admin_audit_log
         where action = 'profile.update' and actor_id = $1 and result = 'ok'`,
        [am1Id],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  test("AM renames an in-scope manager; SA renames every kind; out-of-scope and manager-as-actor denied", async () => {
    const c = await db.client();
    await okVerdict(c, "update_staff_profile", {
      p_actor_kind: "area_manager",
      p_actor_id: am1Id,
      p_target_kind: "manager",
      p_target_id: managerId,
      p_full_name: "Kasir Satgas Baru",
    });
    for (const [kind, id] of [
      ["super_admin", sa1Id],
      ["area_manager", am2Id],
      ["manager", managerId],
    ] as const) {
      await okVerdict(c, "update_staff_profile", {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: kind,
        p_target_id: id,
        p_full_name: `SA Rename ${kind}`,
      });
    }
    const r3Manager = await oneText(
      c,
      `select id::text from public.manager_accounts where id_manager = 'kasir.restotiga'`,
    );
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_target_kind: "manager",
        p_target_id: r3Manager,
        p_full_name: "Out of scope",
      },
      "NOT_AUTHORIZED",
    );
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "manager",
        p_actor_id: managerId,
        p_target_kind: "manager",
        p_target_id: managerId,
        p_full_name: "Self rename",
      },
      "NOT_AUTHORIZED",
    );
    expect(
      await scalar(
        c,
        `select count(*) as n from public.admin_audit_log
         where action = 'profile.update' and actor_id = $1 and restaurant_id = $2
           and result = 'denied' and reason = 'not authorized'`,
        [am1Id, R3],
      ),
    ).toBeGreaterThanOrEqual(1);
  });

  test("GUARD (R3-F): renaming an INACTIVE target fails NOT_FOUND", async () => {
    const c = await db.client();
    await okVerdict(c, "set_manager_status", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_manager_id: managerId,
      p_new_status: "nonaktif",
    });
    for (const [kind, id] of [
      ["area_manager", am1Id],
      ["super_admin", sa1Id],
    ] as const) {
      await expectDenial(
        c,
        "update_staff_profile",
        {
          p_actor_kind: kind,
          p_actor_id: id,
          p_target_kind: "manager",
          p_target_id: managerId,
          p_full_name: "Ghost",
        },
        "NOT_FOUND",
      );
    }
    // Inactive AM target (cover R3 with am1 first so the lifecycle guard
    // allows freeing am2).
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "revoke_area_manager_assignment", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am2Id,
      p_new_status: "nonaktif",
    });
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "area_manager",
        p_target_id: am2Id,
        p_full_name: "Ghost",
      },
      "NOT_FOUND",
    );
    // Restore canonical state; IDs never changed anywhere.
    await okVerdict(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am2Id,
      p_new_status: "aktif",
    });
    await okVerdict(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "revoke_area_manager_assignment", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R3,
    });
    await okVerdict(c, "set_manager_status", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_manager_id: managerId,
      p_new_status: "aktif",
    });
    expect(
      await oneText(c, `select id_manager from public.manager_accounts where id = $1`, [managerId]),
    ).toBe("kasir.satgas01");
  });
});

describe("R3-G: realtime bind isolation under revocation", () => {
  test("revoked manager token cannot bind and grants no broadcast read", async () => {
    const c = await db.client();
    const user = await oneText(
      c,
      `insert into auth.users (email) values ('r3.revoke@example.test') returning (id::text) as n`,
    );
    const token = await mintActiveManagerSession(c, managerId);
    await rpcOk<boolean>(c, "revoke_manager_session_by_token", { p_token: token });
    const b = await freshClient();
    await b.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    const bound = await rpcNamed<boolean>(b, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: token,
    });
    expect(bound.error ?? "").toContain("INVALID_SESSION");
    expect(
      await rpcOk<boolean>(b, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R1}`,
      }),
    ).toBe(false);
    await b.end();
  });

  test("live manager token binds ONLY its own restaurant", async () => {
    const c = await db.client();
    const user = await oneText(
      c,
      `insert into auth.users (email) values ('r3.live@example.test') returning (id::text) as n`,
    );
    const token = await mintActiveManagerSession(c, managerId);
    const b = await freshClient();
    await b.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    const bound = await rpcNamed<boolean>(b, "bind_manager_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: token,
    });
    expect(bound.error).toBeNull();
    expect(bound.data).toBe(true);
    expect(
      await rpcOk<boolean>(b, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R1}`,
      }),
    ).toBe(true);
    expect(
      await rpcOk<boolean>(b, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R2}`,
      }),
    ).toBe(false);
    const forged = await rpcNamed<boolean>(b, "bind_manager_session_realtime", {
      p_restaurant_id: R2,
      p_session_token: token,
    });
    expect(forged.error ?? "").toContain("INVALID_SESSION");
    await b.end();
    await rpcOk<boolean>(c, "revoke_manager_session_by_token", { p_token: token });
  });

  test("unknown/absent role-session token cannot bind a role channel", async () => {
    const c = await db.client();
    const user = await oneText(
      c,
      `insert into auth.users (email) values ('r3.role@example.test') returning (id::text) as n`,
    );
    const b = await freshClient();
    await b.query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
    const bound = await rpcNamed<boolean>(b, "bind_role_session_realtime", {
      p_restaurant_id: R1,
      p_session_token: "deadbeef-dead-beef-dead-deadbeefdead",
    });
    expect(bound.error ?? "").toContain("INVALID_SESSION");
    expect(
      await rpcOk<boolean>(b, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R1}`,
      }),
    ).toBe(false);
    await b.end();
  });
});

describe("R4-B: stale-token replay after revocation is rejected server-side", () => {
  test("revoked manager token maps to NO account and cannot mint anything", async () => {
    const c = await db.client();
    const token = await mintActiveManagerSession(c, managerId);
    expect(await rpcOk<string | null>(c, "get_manager_id_by_token", { p_token: token })).toBe(
      managerId,
    );
    await rpcOk<boolean>(c, "revoke_manager_session_by_token", { p_token: token });
    expect(await rpcOk<string | null>(c, "get_manager_id_by_token", { p_token: token })).toBeNull();
  });

  test("revoked staff token maps to NO account", async () => {
    const c = await db.client();
    const token = await rpcOk<string>(c, "create_staff_session", {
      p_kind: "area_manager",
      p_account_id: am1Id,
    });
    await rpcOk<boolean>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: token,
    });
    expect(
      await rpcOk<string | null>(c, "get_staff_session", {
        p_kind: "area_manager",
        p_token: token,
      }),
    ).toBeNull();
  });
});

describe("R4-C: rate-limit completion is durable and one-outcome per attempt", () => {
  const clientHash = "a".repeat(64);
  const ipHash = "b".repeat(64);

  test("successful completion consumes the reservation exactly once and clears failures", async () => {
    const c = await db.client();
    const rid = await rpcOk<string>(c, "reserve_owner_login_attempt", {
      p_client_bucket_hash: clientHash,
      p_ip_bucket_hash: ipHash,
    });
    expect(rid).toBeTruthy();
    // R6-C: completion returns a structured verdict, exactly once per reservation.
    expect(
      await rpcOk<string>(c, "complete_owner_login_attempt", {
        p_reservation_id: rid,
        p_success: true,
      }),
    ).toBe("SUCCEEDED");
    // One durable outcome: a second completion of the SAME reservation cannot
    // flip the decided outcome.
    expect(
      await rpcOk<string>(c, "complete_owner_login_attempt", {
        p_reservation_id: rid,
        p_success: false,
      }),
    ).toBe("ALREADY_SUCCEEDED");
    const consumed = await oneText(
      c,
      `select (consumed_at is not null)::text as n from public.owner_login_rate_limit_reservations where id = $1`,
      [rid],
    );
    expect(consumed).toBe("true");
    const failures = await scalar(
      c,
      `select failures from public.owner_login_rate_limit_buckets where bucket_hash = $1`,
      [clientHash],
    );
    expect(failures).toBe(0);
  });

  test("failed completion records a durable failure on the bucket", async () => {
    const c = await db.client();
    const rid = await rpcOk<string>(c, "reserve_owner_login_attempt", {
      p_client_bucket_hash: clientHash,
      p_ip_bucket_hash: ipHash,
    });
    expect(
      await rpcOk<string>(c, "complete_owner_login_attempt", {
        p_reservation_id: rid,
        p_success: false,
      }),
    ).toBe("FAILED");
    const failures = await scalar(
      c,
      `select failures from public.owner_login_rate_limit_buckets where bucket_hash = $1`,
      [clientHash],
    );
    expect(failures).toBe(1);
  });
});

describe("R4-E: profile denials are durably audited with safe attribution", () => {
  async function latestProfileAudit(c: Client): Promise<{
    actor_kind: string;
    actor_id: string | null;
    actor_label: string | null;
    result: string;
    reason: string | null;
    attempted: string | null;
  }> {
    const row = await c.query(
      `select actor_kind, actor_id::text as actor_id, actor_label, result, reason,
              metadata->>'attempted_actor_kind' as attempted
       from public.admin_audit_log
       where action = 'profile.update'
       order by created_at desc, id desc
       limit 1`,
    );
    return row.rows[0];
  }

  test("INVALID_NAME is audited with the real actor", async () => {
    const c = await db.client();
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "manager",
        p_target_id: managerId,
        p_full_name: "   ",
      },
      "INVALID_NAME",
    );
    const audit = await latestProfileAudit(c);
    expect(audit.result).toBe("denied");
    expect(audit.reason).toBe("invalid name");
    expect(audit.actor_kind).toBe("super_admin");
    expect(audit.actor_id).toBe(sa1Id);
    expect(audit.attempted).toBe("super_admin");
  });

  test("an UNKNOWN actor kind is recorded as 'system' WITHOUT losing the actor id", async () => {
    const c = await db.client();
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "manager",
        p_actor_id: managerId,
        p_target_kind: "manager",
        p_target_id: managerId,
        p_full_name: "   ",
      },
      "INVALID_NAME",
    );
    const audit = await latestProfileAudit(c);
    expect(audit.actor_kind).toBe("system");
    expect(audit.attempted).toBe("manager");
    expect(audit.actor_id).toBe(managerId);
  });

  test("INVALID_TARGET is audited", async () => {
    const c = await db.client();
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "crew",
        p_target_id: managerId,
        p_full_name: "Valid Name",
      },
      "INVALID_TARGET",
    );
    const audit = await latestProfileAudit(c);
    expect(audit.result).toBe("denied");
    expect(audit.reason).toBe("invalid target kind");
    expect(audit.actor_id).toBe(sa1Id);
  });

  test("unknown target is audited as 'target not found'", async () => {
    const c = await db.client();
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "manager",
        p_target_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        p_full_name: "Valid Name",
      },
      "NOT_FOUND",
    );
    const audit = await latestProfileAudit(c);
    expect(audit.reason).toBe("target not found");
    expect(audit.result).toBe("denied");
  });

  test("INACTIVE target is audited as 'target inactive'", async () => {
    const c = await db.client();
    const created = await okVerdict(c, "create_manager_account", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_staff_id: "r4.audit.target",
      p_full_name: "R4 Audit Target",
      p_restaurant_id: R2,
      p_password_hash: "salt:hash",
    });
    const targetId = created.id as string;
    await okVerdict(c, "set_manager_status", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_manager_id: targetId,
      p_new_status: "nonaktif",
    });
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "manager",
        p_target_id: targetId,
        p_full_name: "Ghost Rename",
      },
      "NOT_FOUND",
    );
    const audit = await latestProfileAudit(c);
    expect(audit.reason).toBe("target inactive");
    expect(audit.result).toBe("denied");
    // Cleanup: remove the disposable manager from the registry namespace.
    await c.query(`delete from public.manager_accounts where id = $1`, [targetId]);
    await c.query(`delete from public.staff_id_registry where account_id = $1`, [targetId]);
  });

  test("PENDING-INVITE super admin target is audited as 'target pending activation'", async () => {
    const c = await db.client();
    const invite = await okVerdict(c, "create_super_admin_invite", {
      p_staff_id: "r4.pending",
      p_full_name: "R4 Pending",
      p_email: "r4.pending@example.test",
      p_invitation_token_hash: "x".repeat(64),
      p_creator_id: sa1Id,
    });
    const pendingId = invite.id as string;
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "super_admin",
        p_target_id: pendingId,
        p_full_name: "Pending Rename",
      },
      "NOT_FOUND",
    );
    const audit = await latestProfileAudit(c);
    expect(audit.reason).toBe("target pending activation");
    expect(audit.result).toBe("denied");
    await okVerdict(c, "cancel_super_admin_invite", {
      p_super_admin_id: pendingId,
      p_actor_id: sa1Id,
    });
  });

  test("INVALID_NAME denial metadata carries ONLY the attempted actor kind (no payload)", async () => {
    const c = await db.client();
    await expectDenial(
      c,
      "update_staff_profile",
      {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_target_kind: "manager",
        p_target_id: managerId,
        p_full_name: "   ",
      },
      "INVALID_NAME",
    );
    const exact = await oneText(
      c,
      `select (metadata = jsonb_build_object('attempted_actor_kind', 'super_admin'))::text
       from public.admin_audit_log
       where action = 'profile.update' order by created_at desc, id desc limit 1`,
    );
    expect(exact).toBe("true");
  });
});
