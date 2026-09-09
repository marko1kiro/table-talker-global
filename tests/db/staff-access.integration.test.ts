// Executable DB-level proof for Poin 2 (TASKLET review fixes). Runs the FULL
// migration chain against a disposable vanilla Postgres (embedded locally,
// service container in CI via TEST_DATABASE_URL) with a legacy-schema seed
// inserted between the pre-Poin-2 and Poin-2 migrations, then exercises the
// real RPCs — including true parallel connections for race conditions.
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
  rpc,
  rpcOk,
  rpcRows,
  scryptHash,
  sha256Hex,
  stopAll,
  type LegacySeed,
  type TestDb,
} from "./harness";

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

async function expectRpcError(
  promise: Promise<{ error: string | null }>,
  fragment: string,
): Promise<void> {
  const result = await promise;
  expect(result.error ?? "").toContain(fragment);
}

async function scalar(client: Client, sql: string, params: unknown[] = []): Promise<number> {
  const result = await client.query(sql, params);
  return Number(Object.values(result.rows[0] ?? { n: 0 })[0]);
}

async function oneText(client: Client, sql: string, params: unknown[] = []): Promise<string> {
  const result = await client.query(sql, params);
  return String(Object.values(result.rows[0] ?? { v: "" })[0]);
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
    expect(ids).toContain("aguskasir");
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
    const backfill = migrationFiles().find((f) => f.includes("backfill_staff_id_registry"));
    expect(backfill).toBeTruthy();
    await c.query("begin");
    try {
      await c.query(
        `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
         values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa9', 'BUDI.SANTOSO', 'Collision', $1, 'x:y', 'aktif')`,
        [R3],
      );
      const sql = readFileSync(
        fileURLToPath(new URL(`../../supabase/migrations/${backfill}`, import.meta.url)),
        "utf8",
      );
      await expect(c.query(sql)).rejects.toThrow(/STAFF_ID_BACKFILL_COLLISION/);
    } finally {
      await c.query("rollback");
    }
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
        rpc<string>(c1, "bootstrap_create_super_admin", {
          p_staff_id: "sa.utama",
          p_full_name: "SA Utama",
          p_email: "sa.utama@example.test",
          p_verify_token_hash: sha256Hex(rawA),
        }),
      () =>
        rpc<string>(c2, "bootstrap_create_super_admin", {
          p_staff_id: "sa.kedua",
          p_full_name: "SA Kedua",
          p_email: "sa.kedua@example.test",
          p_verify_token_hash: sha256Hex(rawB),
        }),
    ]);
    await c1.end();
    await c2.end();
    const winners = [a, b].filter((r) => !r.error && typeof r.data === "string");
    expect(winners).toHaveLength(1);
    const loser = a.error ? a : b;
    expect(loser.error).toContain("BOOTSTRAP_CLOSED");
    bootstrapRawToken = a.error ? rawB : rawA;
    bootstrapWinnerStaffId = a.error ? "sa.kedua" : "sa.utama";
    sa1Id = String(winners[0].data);
  });

  test("raw token accepted end-to-end; gate closes permanently", async () => {
    const c = await db.client();
    // The token that was EMAILED (raw) must satisfy sha256(raw) == stored hash.
    const accepted = await rpc<boolean>(c, "accept_super_admin_invite", {
      p_staff_id: bootstrapWinnerStaffId,
      p_token: bootstrapRawToken,
      p_password_hash: await scryptHash("PasswordKuat#1"),
    });
    expect(accepted.error).toBeNull();
    expect(accepted.data).toBe(true);
    const state = (await rpcOk<Record<string, unknown>>(c, "bootstrap_super_admin_state", {})) as {
      open: boolean;
      active_count: number;
    };
    expect(state.open).toBe(false);
    expect(Number(state.active_count)).toBe(1);
    // Replay of the same token fails.
    await expectRpcError(
      rpc(c, "accept_super_admin_invite", {
        p_staff_id: bootstrapWinnerStaffId,
        p_token: bootstrapRawToken,
        p_password_hash: "x:y",
      }),
      "INVALID_INVITATION",
    );
  });
});

describe("manager creation: atomic claim, collisions, scope", () => {
  test("Super Admin creates a manager; registry row lands atomically", async () => {
    const c = await db.client();
    const id = await rpcOk<string>(c, "create_manager_account", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_staff_id: "kasir.satgas01",
      p_full_name: "Kasir Satgas",
      p_restaurant_id: R1,
      p_password_hash: await scryptHash("AwalManager1"),
    });
    expect(typeof id).toBe("string");
    managerId = String(id);
    const inRegistry = await scalar(
      c,
      `select count(*) as n from public.staff_id_registry
       where staff_id = 'kasir.satgas01' and account_kind = 'manager' and account_id = $1`,
      [managerId],
    );
    expect(inRegistry).toBe(1);
  });

  test("collisions rejected across registry, legacy rows, and roles", async () => {
    const c = await db.client();
    const hash = await scryptHash("AwalManager1");
    await expectRpcError(
      rpc(c, "create_manager_account", {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_staff_id: "KASIR.SATGAS01",
        p_full_name: "Dup",
        p_restaurant_id: R1,
        p_password_hash: hash,
      }),
      "STAFF_ID_TAKEN",
    );
    await expectRpcError(
      rpc(c, "create_manager_account", {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_staff_id: "AgusKasir",
        p_full_name: "Legacy clash",
        p_restaurant_id: R1,
        p_password_hash: hash,
      }),
      "STAFF_ID_TAKEN",
    );
    await expectRpcError(
      rpc(c, "create_manager_account", {
        p_actor_kind: "super_admin",
        p_actor_id: sa1Id,
        p_staff_id: bootstrapWinnerStaffId,
        p_full_name: "Cross-role clash",
        p_restaurant_id: R1,
        p_password_hash: hash,
      }),
      "STAFF_ID_TAKEN",
    );
  });

  test("two concurrent creations of one ID: exactly one winner", async () => {
    const c1 = await freshClient();
    const c2 = await freshClient();
    const hash = await scryptHash("AwalManager1");
    const [a, b] = await parallel([
      () =>
        rpc(c1, "create_manager_account", {
          p_actor_kind: "super_admin",
          p_actor_id: sa1Id,
          p_staff_id: "race.manager",
          p_full_name: "Race A",
          p_restaurant_id: R1,
          p_password_hash: hash,
        }),
      () =>
        rpc(c2, "create_manager_account", {
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
    const wins = [a, b].filter((r) => !r.error).length;
    expect(wins).toBe(1);
    const loss = a.error ? a : b;
    expect(loss.error).toContain("STAFF_ID_TAKEN");
  });

  test("Area Manager in scope creates; out-of-scope denied", async () => {
    const c = await db.client();
    await rpcOk(c, "create_area_manager", {
      p_actor_id: sa1Id,
      p_staff_id: "am.satu",
      p_full_name: "AM Satu",
      p_password_hash: await scryptHash("AmPass#111"),
    });
    await rpcOk(c, "create_area_manager", {
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
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R1,
    });
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R1,
    });
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R2,
    });

    const created = await rpc<string>(c, "create_manager_account", {
      p_actor_kind: "area_manager",
      p_actor_id: am1Id,
      p_staff_id: "kasir.restodua",
      p_full_name: "Kasir Resto Dua",
      p_restaurant_id: R2,
      p_password_hash: await scryptHash("AwalManager2"),
    });
    expect(created.error).toBeNull();
    await expectRpcError(
      rpc(c, "create_manager_account", {
        p_actor_kind: "area_manager",
        p_actor_id: am1Id,
        p_staff_id: "kasir.restotiga",
        p_full_name: "Out of scope",
        p_restaurant_id: R3,
        p_password_hash: "x:y",
      }),
      "NOT_AUTHORIZED",
    );
    // SA creates one in R3 for the audit-scope test.
    await rpcOk(c, "create_manager_account", {
      p_actor_kind: "super_admin",
      p_actor_id: sa1Id,
      p_staff_id: "kasir.restotiga",
      p_full_name: "Kasir Resto Tiga",
      p_restaurant_id: R3,
      p_password_hash: await scryptHash("AwalManager3"),
    });
  });
});

describe("last-active invariants hold under parallelism", () => {
  test("parallel Super Admin deactivations never reach zero active", async () => {
    const c = await db.client();
    // SA1 invites + activates a second individual Super Admin.
    const raw = generateToken();
    sa2Id = String(
      await rpcOk<string>(c, "create_super_admin_invite", {
        p_staff_id: "sa.mitra",
        p_full_name: "SA Mitra",
        p_email: "sa.mitra@example.test",
        p_invitation_token_hash: sha256Hex(raw),
        p_creator_id: sa1Id,
      }),
    );
    const c1 = await freshClient();
    const c2 = await freshClient();
    try {
      await rpcOk(c1, "accept_super_admin_invite", {
        p_staff_id: "sa.mitra",
        p_token: raw,
        p_password_hash: await scryptHash("PasswordKuat#2"),
      });
      // Race their mutual deactivation. Serialized by the lifecycle lock:
      // exactly one succeeds; the other is refused (either LAST_ACTIVE after
      // the first commit, or NOT_AUTHORIZED because its actor was just
      // deactivated). Either way the min-1-active invariant holds.
      const [a, b] = await parallel([
        () =>
          rpc(c1, "set_super_admin_status", {
            p_actor_id: sa1Id,
            p_target_id: sa2Id,
            p_new_status: "nonaktif",
          }),
        () =>
          rpc(c2, "set_super_admin_status", {
            p_actor_id: sa2Id,
            p_target_id: sa1Id,
            p_new_status: "nonaktif",
          }),
      ]);
      const succeeded = [a, b].filter((r) => !r.error);
      expect(succeeded).toHaveLength(1);
      const activeCount = await scalar(
        c,
        `select count(*) as n from public.super_admin_accounts where status = 'aktif'`,
      );
      expect(activeCount).toBe(1);
      // Restore: reactivate the deactivated one so later tests have two admins.
      const deactivatedId = succeeded[0] === a ? sa2Id : sa1Id;
      const actorId = deactivatedId === sa1Id ? sa2Id : sa1Id;
      await rpcOk(c, "set_super_admin_status", {
        p_actor_id: actorId,
        p_target_id: deactivatedId,
        p_new_status: "aktif",
      });
    } finally {
      await c1.end().catch(() => undefined);
      await c2.end().catch(() => undefined);
    }
  });

  test("parallel assignment revokes keep >=1 active AM per restaurant", async () => {
    const c1 = await freshClient();
    const c2 = await freshClient();
    const [a, b] = await parallel([
      () =>
        rpc(c1, "revoke_area_manager_assignment", {
          p_actor_id: sa1Id,
          p_am_id: am1Id,
          p_restaurant_id: R1,
        }),
      () =>
        rpc(c2, "revoke_area_manager_assignment", {
          p_actor_id: sa1Id,
          p_am_id: am2Id,
          p_restaurant_id: R1,
        }),
    ]);
    await c1.end();
    await c2.end();
    const denied = [a, b].filter((r) => (r.error ?? "").includes("LAST_ACTIVE_AREA_MANAGER"));
    expect(denied).toHaveLength(1);
    const c = await db.client();
    const active = await scalar(
      c,
      `select count(distinct a.area_manager_id)::int as n
       from public.area_manager_assignments a
       join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
       where a.restaurant_id = $1 and a.removed_at is null`,
      [R1],
    );
    expect(active).toBeGreaterThanOrEqual(1);
  });

  test("parallel AM deactivations keep >=1 active AM per restaurant", async () => {
    const c = await db.client();
    // Make sure both AMs are active and (re-)assigned to R1 — the revoke race
    // in the previous test removed exactly one of them from R1.
    await rpcOk(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am1Id,
      p_new_status: "aktif",
    });
    await rpcOk(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am2Id,
      p_new_status: "aktif",
    });
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R1,
    });
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R1,
    });
    const c1 = await freshClient();
    const c2 = await freshClient();
    try {
      const [a, b] = await parallel([
        () =>
          rpc(c1, "set_area_manager_status", {
            p_actor_id: sa1Id,
            p_target_id: am1Id,
            p_new_status: "nonaktif",
          }),
        () =>
          rpc(c2, "set_area_manager_status", {
            p_actor_id: sa1Id,
            p_target_id: am2Id,
            p_new_status: "nonaktif",
          }),
      ]);
      const denied = [a, b].filter((r) => (r.error ?? "").includes("LAST_ACTIVE_AREA_MANAGER"));
      expect(denied).toHaveLength(1);
      const active = await scalar(
        c,
        `select count(distinct a.area_manager_id)::int as n
         from public.area_manager_assignments a
         join public.area_manager_accounts am on am.id = a.area_manager_id and am.status = 'aktif'
         where a.restaurant_id = $1 and a.removed_at is null`,
        [R1],
      );
      expect(active).toBeGreaterThanOrEqual(1);
    } finally {
      await c1.end().catch(() => undefined);
      await c2.end().catch(() => undefined);
    }
  });

  test("set_area_manager_status on a missing target is NOT_FOUND before any audit", async () => {
    const c = await db.client();
    const ghost = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await expectRpcError(
      rpc(c, "set_area_manager_status", {
        p_actor_id: sa1Id,
        p_target_id: ghost,
        p_new_status: "aktif",
      }),
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

describe("password reset: one-pending, first decision wins, bookkeeping", () => {
  test("duplicate pending rejected; approval flips hash, stamps password_changed_at, revokes sessions", async () => {
    const c = await db.client();
    // The previous race tests leave one AM deactivated: restore a deterministic
    // state where both AMs are active and assigned to the manager's restaurant.
    await rpcOk(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am1Id,
      p_new_status: "aktif",
    });
    await rpcOk(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am2Id,
      p_new_status: "aktif",
    });
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am1Id,
      p_restaurant_id: R1,
    });
    await rpcOk(c, "assign_area_manager", {
      p_actor_id: sa1Id,
      p_am_id: am2Id,
      p_restaurant_id: R1,
    });
    const candidate = await scryptHash("PasswordBaru#1");
    expect(
      await rpcOk<boolean>(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: candidate,
      }),
    ).toBe(true);
    expect(
      await rpc<boolean>(c, "submit_manager_reset_request", {
        p_staff_id: "kasir.satgas01",
        p_candidate_hash: candidate,
      }),
    ).toMatchObject({ data: false });
    const before = await rpcOk<string>(c, "create_manager_session", { p_manager_id: managerId });
    expect(typeof before).toBe("string");
    const pendingId = await oneText(
      c,
      `select id::text as n from public.manager_reset_requests where manager_id = $1 and status = 'pending'`,
      [managerId],
    );
    expect(
      await rpcOk<boolean>(c, "decide_manager_reset", {
        p_decider_kind: "area_manager",
        p_decider_id: am2Id,
        p_request_id: pendingId,
        p_decision: "approved",
      }),
    ).toBe(true);
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
  });

  test("Super Admin is not a Manager reset approver; first decision wins under parallelism", async () => {
    const c = await db.client();
    await rpcOk<boolean>(c, "submit_manager_reset_request", {
      p_staff_id: "kasir.satgas01",
      p_candidate_hash: await scryptHash("PasswordBaru#2"),
    });
    const requestId = await oneText(
      c,
      `select id::text as n from public.manager_reset_requests where manager_id = $1 and status = 'pending'`,
      [managerId],
    );
    await expectRpcError(
      rpc(c, "decide_manager_reset", {
        p_decider_kind: "super_admin",
        p_decider_id: sa1Id,
        p_request_id: requestId,
        p_decision: "approved",
      }),
      "NOT_AUTHORIZED",
    );
    const c1 = await freshClient();
    const c2 = await freshClient();
    const [a, b] = await parallel([
      () =>
        rpc<boolean>(c1, "decide_manager_reset", {
          p_decider_kind: "area_manager",
          p_decider_id: am1Id,
          p_request_id: requestId,
          p_decision: "approved",
        }),
      () =>
        rpc<boolean>(c2, "decide_manager_reset", {
          p_decider_kind: "area_manager",
          p_decider_id: am2Id,
          p_request_id: requestId,
          p_decision: "rejected",
        }),
    ]);
    await c1.end();
    await c2.end();
    const trueCount = [a, b].filter((r) => !r.error && r.data === true).length;
    expect(trueCount).toBe(1);
  });

  test("AM reset approved by Super Admin stamps password_changed_at and revokes sessions", async () => {
    const c = await db.client();
    await rpcOk(c, "set_area_manager_status", {
      p_actor_id: sa1Id,
      p_target_id: am1Id,
      p_new_status: "aktif",
    });
    const candidate = await scryptHash("AmNewPass#11");
    expect(
      await rpcOk<boolean>(c, "submit_am_reset_request", {
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
    expect(
      await rpcOk<boolean>(c, "decide_am_reset", {
        p_decider_id: sa1Id,
        p_request_id: requestId,
        p_decision: "approved",
      }),
    ).toBe(true);
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

describe("audit read models: scoped, hash-free", () => {
  test("AM sees scoped manager events incl. reset lifecycle; nothing out of scope; no metadata", async () => {
    const c = await db.client();
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

describe("realtime isolation for Manager", () => {
  test("channel authorization is bound to the manager's own restaurant only", async () => {
    const c = await db.client();
    const u1 = await oneText(
      c,
      `insert into auth.users (email) values ('m1.device@example.test') returning (id::text) as n`,
    );
    const u2 = await oneText(
      c,
      `insert into auth.users (email) values ('intruder@example.test') returning (id::text) as n`,
    );
    const managerToken = await rpcOk<string>(c, "create_manager_session", {
      p_manager_id: managerId,
    });

    const b1 = await freshClient();
    await b1.query("select set_config('request.jwt.claim.sub', $1, false)", [u1]);
    expect(
      await rpcOk<boolean>(b1, "bind_manager_session_realtime", {
        p_restaurant_id: R1,
        p_manager_token: managerToken,
      }),
    ).toBe(true);
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
    await b1.end();

    // Intruder with a stolen bearer token but a different auth identity.
    const b2 = await freshClient();
    await b2.query("select set_config('request.jwt.claim.sub', $1, false)", [u2]);
    await expectRpcError(
      rpc(b2, "bind_manager_session_realtime", {
        p_restaurant_id: R1,
        p_manager_token: managerToken,
      }),
      "INVALID_SESSION",
    );
    expect(
      await rpcOk<boolean>(b2, "can_read_table_occupancy_broadcast", {
        p_topic: `table-occupancy:${R1}`,
      }),
    ).toBe(false);
    await b2.end();

    // RLS on realtime.messages mirrors Supabase's per-channel authorization:
    // the policy evaluates can_read_table_occupancy_broadcast(realtime.topic())
    // for the channel the client subscribes to. Bound user on R1 channel sees
    // R1 traffic; the same user's foreign R2 channel subscription is denied.
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

describe("Super Admin recovery tokens", () => {
  test("single-use raw token resets password and revokes sessions", async () => {
    const c = await db.client();
    const raw = generateToken();
    const beforeHash = await c.query(
      `select password_hash from public.super_admin_accounts where id = $1`,
      [sa2Id],
    );
    await rpcOk(c, "create_staff_session", { p_kind: "super_admin", p_account_id: sa2Id });
    await rpcOk(c, "create_super_admin_recovery_token", {
      p_super_admin_id: sa2Id,
      p_token_hash: sha256Hex(raw),
    });
    const newHash = await scryptHash("Recovered#123");
    expect(
      await rpcOk<boolean>(c, "consume_super_admin_recovery_token", {
        p_super_admin_id: sa2Id,
        p_token: raw,
        p_password_hash: newHash,
      }),
    ).toBe(true);
    const afterHash = await c.query(
      `select password_hash from public.super_admin_accounts where id = $1`,
      [sa2Id],
    );
    expect(String(afterHash.rows[0].password_hash)).not.toBe(
      String(beforeHash.rows[0].password_hash),
    );
    const sessions = await scalar(
      c,
      `select count(*) as n from public.staff_sessions where session_kind = 'super_admin' and account_id = $1`,
      [sa2Id],
    );
    expect(sessions).toBe(0);
    await expectRpcError(
      rpc(c, "consume_super_admin_recovery_token", {
        p_super_admin_id: sa2Id,
        p_token: raw,
        p_password_hash: "x:y",
      }),
      "INVALID_TOKEN",
    );
  });
});

describe("privilege surface", () => {
  test("staff RPCs are service_role-only; audit log stays append-only", async () => {
    const c = await db.client();
    const sig = "create_manager_account(text,uuid,text,text,uuid,text)";
    expect(
      await scalar(
        c,
        `select has_function_privilege('anon', 'public.${sig}', 'execute')::int as n`,
      ),
    ).toBe(0);
    expect(
      await scalar(
        c,
        `select has_function_privilege('authenticated', 'public.${sig}', 'execute')::int as n`,
      ),
    ).toBe(0);
    expect(
      await scalar(
        c,
        `select has_function_privilege('service_role', 'public.${sig}', 'execute')::int as n`,
      ),
    ).toBe(1);
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
