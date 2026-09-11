// R12-A (blocker P0-1) disposable-Postgres regression suite.
//
// Every manager mutation RPC that revokes manager sessions must acquire locks
// strictly parent-first: restaurant FK parent row -> manager account row ->
// manager advisory lock -> manager child row. Before this fix the three RPCs
// below held the manager row (or the reset-request child) and only afterwards
// asked for the restaurant parent inside revoke_manager_sessions, so a
// concurrent `delete from public.restaurants` produced a real lock cycle and
// PostgreSQL killed one side with SQLSTATE 40P01.
//
// Each race test is deterministic: a test-only AFTER UPDATE barrier on
// manager_accounts pauses the RPC at the exact moment it has mutated the
// manager row, the restaurant DELETE is only started once the RPC is observed
// waiting, and the DELETE is only released once it is observed waiting too.
// With the old child-first order that interleaving deadlocks; with the fixed
// order both transactions queue and both succeed.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  connect,
  createTestDb,
  mintActiveManagerSession,
  rpc,
  scryptHash,
  sha256Hex,
  stopAll,
  type TestDb,
} from "./harness";

const AM_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SA_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

let db: TestDb;
type Verdict = { verdict?: string };
type RpcResult = { ok?: boolean; error?: string };

beforeAll(async () => {
  db = await createTestDb("lime_manager_mutation_lock_order");
  const c = await db.client();
  await c.query(
    `insert into public.area_manager_accounts (id, staff_id, full_name, password_hash, status)
     values ($1, 'am.lockorder', 'AM Lock Order', 'salt:hash', 'aktif')`,
    [AM_ID],
  );
  await c.query(
    `insert into public.super_admin_accounts (id, staff_id, full_name, email, password_hash, status)
     values ($1, 'sa.lockorder', 'SA Lock Order', 'sa.lockorder@example.test', 'salt:hash', 'aktif')`,
    [SA_ID],
  );
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

afterEach(async () => {
  const c = await db.client();
  await c.query(`drop trigger if exists test_manager_mutation_barrier on public.manager_accounts`);
  await c.query(`drop function if exists public.test_manager_mutation_barrier()`);
});

let seq = 0;

/** A fresh restaurant + active manager + AM assignment per scenario, so a
 * cascading restaurant DELETE in one test cannot disturb another. */
async function seedScenario(): Promise<{ restaurantId: string; managerId: string }> {
  const c = await db.client();
  seq += 1;
  const suffix = String(seq).padStart(2, "0");
  const restaurantId = `33333333-3333-4333-8333-3333333333${suffix}`;
  const managerId = `cccccccc-cccc-4ccc-8ccc-cccccccccc${suffix}`;
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, $2, $3, encode(extensions.digest($4, 'sha256'), 'hex'), now())`,
    [restaurantId, `RESTO-LO-${suffix}`, `Resto Lock Order ${suffix}`, `lock-order-pin-${suffix}`],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, $2, 'Manager Lock Order', $3, $4, 'aktif')`,
    [managerId, `lockorder.${suffix}`, restaurantId, await scryptHash("pw")],
  );
  await c.query(
    `insert into public.area_manager_assignments (area_manager_id, restaurant_id)
     values ($1, $2)`,
    [AM_ID, restaurantId],
  );
  return { restaurantId, managerId };
}

/** Installs the AFTER UPDATE barrier on manager_accounts for one scenario. */
async function installBarrier(): Promise<void> {
  const c = await db.client();
  await c.query(
    `create or replace function public.test_manager_mutation_barrier() returns trigger
     language plpgsql as $$ begin perform pg_advisory_xact_lock(992, 1); return new; end $$`,
  );
  await c.query(
    `create trigger test_manager_mutation_barrier after update on public.manager_accounts
     for each row execute function public.test_manager_mutation_barrier()`,
  );
}

async function backendPid(client: Awaited<ReturnType<TestDb["client"]>>): Promise<number> {
  return Number((await client.query(`select pg_backend_pid() as pid`)).rows[0]?.pid);
}

/** Waits until `pid` is blocked on an ungranted ADVISORY lock (the barrier). */
async function waitForAdvisoryWait(
  c: Awaited<ReturnType<TestDb["client"]>>,
  pid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await c.query<{ waiting: boolean }>(
      `select exists (select 1 from pg_locks l where l.pid = a.pid
               and l.locktype = 'advisory' and not l.granted) as waiting
       from pg_stat_activity a where a.pid = $1`,
      [pid],
    );
    if (state.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} did not wait for the barrier advisory lock`);
}

/** Waits until `pid` is blocked on an ungranted ROW/RELATION lock — i.e. the
 * cascading DELETE is queued behind the mutation's parent row lock rather than
 * having formed a cycle with it. */
async function waitForRowLockWait(
  c: Awaited<ReturnType<TestDb["client"]>>,
  pid: number,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const state = await c.query<{ waiting: boolean }>(
      `select exists (select 1 from pg_locks l where l.pid = a.pid
               and l.locktype <> 'advisory' and not l.granted) as waiting
       from pg_stat_activity a where a.pid = $1`,
      [pid],
    );
    if (state.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} did not queue behind the restaurant parent row lock`);
}

/**
 * Drives one deterministic mutation-vs-restaurant-delete race and asserts that
 * neither side deadlocks, the mutation succeeds, and the old manager bearer
 * ends terminally revoked.
 */
async function expectNoDeadlockWithRestaurantDelete(options: {
  restaurantId: string;
  managerId: string;
  token: string;
  runMutation: (
    client: Awaited<ReturnType<TestDb["client"]>>,
  ) => Promise<{ data: unknown; error: string | null }>;
}): Promise<unknown> {
  const c = await db.client();
  const blocker = await connect(db.connectionString);
  const mutator = await connect(db.connectionString);
  const deleter = await connect(db.connectionString);
  let blockerOpen = false;
  try {
    await installBarrier();
    await blocker.query("begin");
    blockerOpen = true;
    await blocker.query("select pg_advisory_xact_lock(992, 1)");

    const mutatorPid = await backendPid(mutator);
    const mutating = options.runMutation(mutator);
    // The RPC has now taken restaurant -> manager -> advisory and mutated the
    // manager row; it is parked in the barrier holding those locks.
    await waitForAdvisoryWait(c, mutatorPid);

    const deleterPid = await backendPid(deleter);
    const deleting = deleter.query(`delete from public.restaurants where id = $1`, [
      options.restaurantId,
    ]);
    // Proof of correct direction: the DELETE queues behind the parent row the
    // mutation already holds. Under the old order it would instead acquire the
    // restaurant row and then deadlock against the mutation.
    await waitForRowLockWait(c, deleterPid);

    await blocker.query("commit");
    blockerOpen = false;

    const mutationResult = await mutating;
    expect(mutationResult.error).toBeNull();
    await expect(deleting).resolves.toEqual(expect.anything());

    expect(
      (await c.query(`select 1 from public.restaurants where id = $1`, [options.restaurantId]))
        .rowCount,
    ).toBe(0);
    expect(
      (await c.query(`select 1 from public.manager_accounts where id = $1`, [options.managerId]))
        .rowCount,
    ).toBe(0);
    expect(
      (
        await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [
          sha256Hex(options.token),
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: options.token })).data
        ?.verdict,
    ).toBe("ALREADY_INACTIVE");
    return mutationResult.data;
  } finally {
    if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
    await Promise.all([blocker.end(), mutator.end(), deleter.end()]);
  }
}

describe("R12-A: manager mutation RPCs lock the restaurant parent before the manager child", () => {
  test("set_staff_password('manager') cannot deadlock with a cascading restaurant delete", async () => {
    const c = await db.client();
    const { restaurantId, managerId } = await seedScenario();
    const token = await mintActiveManagerSession(c, managerId);

    const data = await expectNoDeadlockWithRestaurantDelete({
      restaurantId,
      managerId,
      token,
      runMutation: (client) =>
        rpc<RpcResult>(client, "set_staff_password", {
          p_kind: "manager",
          p_account_id: managerId,
          p_password_hash: "newsalt:newhash",
        }).then((r) => r as { data: unknown; error: string | null }),
    });
    expect(data).toMatchObject({ ok: true });
  });

  test("set_manager_status cannot deadlock with a cascading restaurant delete", async () => {
    const c = await db.client();
    const { restaurantId, managerId } = await seedScenario();
    const token = await mintActiveManagerSession(c, managerId);

    const data = await expectNoDeadlockWithRestaurantDelete({
      restaurantId,
      managerId,
      token,
      runMutation: (client) =>
        rpc<RpcResult>(client, "set_manager_status", {
          p_actor_kind: "area_manager",
          p_actor_id: AM_ID,
          p_manager_id: managerId,
          p_new_status: "nonaktif",
        }).then((r) => r as { data: unknown; error: string | null }),
    });
    expect(data).toMatchObject({ ok: true });
  });

  test("decide_manager_reset approval cannot deadlock with a cascading restaurant delete", async () => {
    const c = await db.client();
    const { restaurantId, managerId } = await seedScenario();
    const token = await mintActiveManagerSession(c, managerId);
    const requestId = (
      await c.query<{ id: string }>(
        `insert into public.manager_reset_requests (manager_id, candidate_hash, status)
         values ($1, 'candsalt:candhash', 'pending') returning id`,
        [managerId],
      )
    ).rows[0].id;

    const data = await expectNoDeadlockWithRestaurantDelete({
      restaurantId,
      managerId,
      token,
      runMutation: (client) =>
        rpc<RpcResult>(client, "decide_manager_reset", {
          p_decider_kind: "area_manager",
          p_decider_id: AM_ID,
          p_request_id: requestId,
          p_decision: "approved",
        }).then((r) => r as { data: unknown; error: string | null }),
    });
    expect(data).toMatchObject({ ok: true });
  });

  test("password change still swaps the hash, stamps the change and revokes every bearer", async () => {
    const c = await db.client();
    const { managerId } = await seedScenario();
    const token = await mintActiveManagerSession(c, managerId);

    const result = await rpc<RpcResult>(c, "set_staff_password", {
      p_kind: "manager",
      p_account_id: managerId,
      p_password_hash: "rotated:hash",
    });
    expect(result).toMatchObject({ data: { ok: true }, error: null });
    const account = await c.query<{ password_hash: string; password_changed_at: string | null }>(
      `select password_hash, password_changed_at from public.manager_accounts where id = $1`,
      [managerId],
    );
    expect(account.rows[0]?.password_hash).toBe("rotated:hash");
    expect(account.rows[0]?.password_changed_at).not.toBeNull();
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("ALREADY_INACTIVE");
    // Regression guard for the separate defect this suite uncovered: the audit
    // insert used to abort the whole RPC because 'manager' was not an accepted
    // actor_kind, so a Manager could never rotate a password and the mandatory
    // revocation above never ran.
    const audit = await c.query<{ actor_kind: string; result: string }>(
      `select actor_kind, result from public.admin_audit_log
       where action = 'password.change' and target_kind = 'manager' and target_id = $1`,
      [managerId],
    );
    expect(audit.rows).toEqual([{ actor_kind: "manager", result: "ok" }]);
  });

  test("an inactive or missing manager is still denied without touching sessions", async () => {
    const c = await db.client();
    const { managerId } = await seedScenario();
    const token = await mintActiveManagerSession(c, managerId);
    await c.query(`update public.manager_accounts set status = 'nonaktif' where id = $1`, [
      managerId,
    ]);

    expect(
      await rpc<RpcResult>(c, "set_staff_password", {
        p_kind: "manager",
        p_account_id: managerId,
        p_password_hash: "must-not-apply",
      }),
    ).toMatchObject({ data: { ok: false, error: "NOT_AUTHORIZED" }, error: null });
    expect(
      (
        await c.query(`select password_hash from public.manager_accounts where id = $1`, [
          managerId,
        ])
      ).rows[0]?.password_hash,
    ).not.toBe("must-not-apply");
    // The denied path must not revoke: the live bearer is still revocable now.
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("REVOKED");
    expect(
      await rpc<RpcResult>(c, "set_staff_password", {
        p_kind: "manager",
        p_account_id: "00000000-0000-4000-8000-000000000099",
        p_password_hash: "x:y",
      }),
    ).toMatchObject({ data: { ok: false, error: "NOT_AUTHORIZED" }, error: null });
    expect(
      await rpc<RpcResult>(c, "set_staff_password", {
        p_kind: "kasir",
        p_account_id: managerId,
        p_password_hash: "x:y",
      }),
    ).toMatchObject({ data: { ok: false, error: "INVALID_KIND" }, error: null });
  });

  test("set_manager_status preserves NOT_FOUND, scope and status validation", async () => {
    const c = await db.client();
    const { managerId } = await seedScenario();

    expect(
      await rpc<RpcResult>(c, "set_manager_status", {
        p_actor_kind: "area_manager",
        p_actor_id: AM_ID,
        p_manager_id: "00000000-0000-4000-8000-000000000098",
        p_new_status: "nonaktif",
      }),
    ).toMatchObject({ data: { ok: false, error: "NOT_FOUND" }, error: null });
    expect(
      await rpc<RpcResult>(c, "set_manager_status", {
        p_actor_kind: "area_manager",
        p_actor_id: AM_ID,
        p_manager_id: managerId,
        p_new_status: "suspended",
      }),
    ).toMatchObject({ data: { ok: false, error: "INVALID_STATUS" }, error: null });
    // An unassigned AM stays out of scope even though the manager exists.
    await c.query(
      `update public.area_manager_assignments set removed_at = now()
       where area_manager_id = $1 and restaurant_id =
         (select restaurant_id from public.manager_accounts where id = $2)`,
      [AM_ID, managerId],
    );
    expect(
      await rpc<RpcResult>(c, "set_manager_status", {
        p_actor_kind: "area_manager",
        p_actor_id: AM_ID,
        p_manager_id: managerId,
        p_new_status: "nonaktif",
      }),
    ).toMatchObject({ data: { ok: false, error: "NOT_AUTHORIZED" }, error: null });
    expect(
      (await c.query(`select status from public.manager_accounts where id = $1`, [managerId]))
        .rows[0]?.status,
    ).toBe("aktif");
  });

  test("decide_manager_reset keeps first-decision-wins and rejects non-AM deciders", async () => {
    const c = await db.client();
    const { managerId } = await seedScenario();
    const token = await mintActiveManagerSession(c, managerId);
    const requestId = (
      await c.query<{ id: string }>(
        `insert into public.manager_reset_requests (manager_id, candidate_hash, status)
         values ($1, 'first:decision', 'pending') returning id`,
        [managerId],
      )
    ).rows[0].id;

    expect(
      await rpc<RpcResult>(c, "decide_manager_reset", {
        p_decider_kind: "super_admin",
        p_decider_id: SA_ID,
        p_request_id: requestId,
        p_decision: "approved",
      }),
    ).toMatchObject({ data: { ok: false, error: "NOT_AUTHORIZED" }, error: null });
    expect(
      await rpc<RpcResult>(c, "decide_manager_reset", {
        p_decider_kind: "area_manager",
        p_decider_id: AM_ID,
        p_request_id: requestId,
        p_decision: "sideways",
      }),
    ).toMatchObject({ data: { ok: false, error: "INVALID_DECISION" }, error: null });
    expect(
      await rpc<RpcResult>(c, "decide_manager_reset", {
        p_decider_kind: "area_manager",
        p_decider_id: AM_ID,
        p_request_id: "00000000-0000-4000-8000-000000000097",
        p_decision: "approved",
      }),
    ).toMatchObject({ data: { ok: false, error: "NOT_FOUND" }, error: null });

    expect(
      await rpc<RpcResult>(c, "decide_manager_reset", {
        p_decider_kind: "area_manager",
        p_decider_id: AM_ID,
        p_request_id: requestId,
        p_decision: "approved",
      }),
    ).toMatchObject({ data: { ok: true }, error: null });
    expect(
      (
        await c.query(`select password_hash from public.manager_accounts where id = $1`, [
          managerId,
        ])
      ).rows[0]?.password_hash,
    ).toBe("first:decision");
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("ALREADY_INACTIVE");
    // The atomic status flip makes the first decision final.
    expect(
      await rpc<RpcResult>(c, "decide_manager_reset", {
        p_decider_kind: "area_manager",
        p_decider_id: AM_ID,
        p_request_id: requestId,
        p_decision: "rejected",
      }),
    ).toMatchObject({ data: { ok: false, error: "ALREADY_DECIDED" }, error: null });
  });

  test("the replaced mutation RPCs keep their service-only, search_path-pinned contract", async () => {
    const c = await db.client();
    const rows = await c.query<{
      name: string;
      prosecdef: boolean;
      config: string[] | null;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(
      `select p.proname as name, p.prosecdef, p.proconfig as config,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = any($1::text[])
       order by p.proname`,
      [["decide_manager_reset", "set_manager_status", "set_staff_password"]],
    );
    expect(rows.rows).toHaveLength(3);
    for (const row of rows.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.config?.join(",")).toContain("search_path=pg_catalog, public");
      expect(row.anon).toBe(false);
      expect(row.authenticated).toBe(false);
      expect(row.service).toBe(true);
    }
  });
});
