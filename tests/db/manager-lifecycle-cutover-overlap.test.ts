// R12-B (blocker P0-2) disposable-Postgres suite: legacy invalid bearer-hash
// overlap repair and manager lifecycle migration cutover locking.
//
// The invariant under test is "one manager bearer hash is one global manager
// lifecycle". R11 only enforced it for a fresh mint, so three things had to be
// proven here:
//
//   1. Upgrade/cutover: a database that ALREADY contains legacy rows violating
//      the invariant (unconfirmed pending whose hash is an active session, or
//      already carries a terminal manager / manager_pending tombstone) must
//      come out of the migration chain with those rows terminalized, with exact
//      evidence, while the normal confirmed-pending + active pair is left
//      untouched. The legacy state is seeded with the R10 lifecycle in place,
//      i.e. BEFORE R11 and the cutover are applied.
//   2. Cutover locking: a legacy lifecycle write that is still in flight cannot
//      interleave with the repair. The migration is observed queueing behind the
//      writer on a real relation lock (no sleeps), and the row the writer
//      committed a moment before the migration proceeds is repaired too. The
//      migration also fails closed if it is applied without a transaction, so
//      the locks it takes cannot silently evaporate mid-cutover.
//   3. Runtime enforcement: the overlap question is asked independently in the
//      exact retry, in confirmation and in reconciliation, so a residual or
//      privileged overlap is fail-closed instead of confirmable.
//
// Every assertion is on exact final rows/verdicts. No raw bearer is stored: the
// tests assert the persisted values are SHA-256 hashes, never the token.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import {
  applyMigrationsAfter,
  connect,
  createTestDb,
  migrationFiles,
  migrationSql,
  mintActiveManagerSession,
  rawHexToken,
  rpc,
  rpcRows,
  scryptHash,
  sha256Hex,
  stopAll,
  type TestDb,
} from "./harness";

/** Last migration of the R10 lifecycle: the "legacy" state we upgrade from. */
const LEGACY_STOP = "20260909140000_manager_pending_tombstone_lifecycle.sql";
/** Last migration before this blocker's cutover. */
const PRE_CUTOVER_STOP = "20260911140000_manager_mutation_parent_lock_order.sql";
const CUTOVER = "20260911150000_manager_lifecycle_cutover_overlap_guard.sql";

const CUTOVER_SQL = migrationSql(CUTOVER);
/** The cutover's own `lock table` statement and its lock proof, taken verbatim
 * from the migration so these tests cannot drift from the shipped file. */
const LOCK_STATEMENT = CUTOVER_SQL.slice(
  CUTOVER_SQL.indexOf("lock table"),
  CUTOVER_SQL.indexOf("in access exclusive mode;") + "in access exclusive mode;".length,
);
const LOCK_PROOF_BLOCK = (() => {
  const start = CUTOVER_SQL.indexOf("do $$");
  return CUTOVER_SQL.slice(start, CUTOVER_SQL.indexOf("$$;", start) + 3);
})();

type Verdict = { verdict?: string };

let seq = 0;

async function seedRestaurant(c: Client): Promise<string> {
  seq += 1;
  const suffix = String(seq).padStart(2, "0");
  const id = `44444444-4444-4444-8444-4444444444${suffix}`;
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, $2, $3, encode(extensions.digest($4, 'sha256'), 'hex'), now())`,
    [id, `RESTO-P02-${suffix}`, `Resto P0-2 ${suffix}`, `p0-2-pin-${suffix}`],
  );
  return id;
}

async function seedManager(c: Client, restaurantId: string): Promise<string> {
  seq += 1;
  const suffix = String(seq).padStart(2, "0");
  const id = `55555555-5555-4555-8555-5555555555${suffix}`;
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, $2, 'Manager P0-2', $3, $4, 'aktif')`,
    [id, `p02.${suffix}`, restaurantId, await scryptHash("pw")],
  );
  return id;
}

async function reserve(c: Client, key: string): Promise<string> {
  const { rows, error } = await rpcRows<{ reservation_id: string }>(
    c,
    "reserve_owner_login_attempt",
    {
      p_client_bucket_hash: sha256Hex(`${key}:client`),
      p_ip_bucket_hash: sha256Hex(`${key}:ip`),
      p_attempt_key: `attempt-${key}-0123456789abcdef`,
    },
  );
  if (error || !rows[0]?.reservation_id) throw new Error(`reservation failed: ${error}`);
  return rows[0].reservation_id;
}

/** Mints one unconfirmed pending handoff through the real RPC. */
async function mintPending(
  c: Client,
  managerId: string,
  key: string,
): Promise<{ token: string; hash: string; reservationId: string }> {
  const reservationId = await reserve(c, key);
  const token = rawHexToken();
  const { data, error } = await rpc<boolean>(c, "create_manager_session_pending", {
    p_manager_id: managerId,
    p_reservation_id: reservationId,
    p_token: token,
  });
  if (error || data !== true) throw new Error(`pending mint failed: ${error ?? data}`);
  return { token, hash: sha256Hex(token), reservationId };
}

async function pendingRow(
  c: Client,
  hash: string,
): Promise<{ id: string; confirmed_at: string | null } | undefined> {
  return (
    await c.query<{ id: string; confirmed_at: string | null }>(
      `select id, confirmed_at from public.manager_pending_sessions where token_hash = $1`,
      [hash],
    )
  ).rows[0];
}

async function tombstones(
  c: Client,
  hash: string,
): Promise<Array<{ namespace: string; pending_reservation_id: string | null }>> {
  return (
    await c.query<{ namespace: string; pending_reservation_id: string | null }>(
      `select namespace, pending_reservation_id from public.revoked_session_tombstones
       where token_hash = $1 order by namespace`,
      [hash],
    )
  ).rows;
}

async function registered(c: Client, hash: string): Promise<boolean> {
  return (
    (
      await c.query(`select 1 from public.manager_bearer_lifecycle_hashes where token_hash = $1`, [
        hash,
      ])
    ).rowCount === 1
  );
}

async function activeSessionManager(c: Client, hash: string): Promise<string | undefined> {
  return (
    await c.query<{ manager_id: string }>(
      `select manager_id from public.manager_sessions where token_hash = $1`,
      [hash],
    )
  ).rows[0]?.manager_id;
}

/** Re-arms the 60s pending + reservation TTLs so a live-row assertion measures
 * the lifecycle classification rather than the suite's own wall clock. */
async function refreshHandoffTtl(c: Client, hash: string, reservationId: string): Promise<void> {
  await c.query(
    `update public.manager_pending_sessions
     set expires_at = clock_timestamp() + interval '60 seconds'
     where token_hash = $1 and confirmed_at is null`,
    [hash],
  );
  await c.query(
    `update public.owner_login_rate_limit_reservations
     set expires_at = clock_timestamp() + interval '60 seconds'
     where id = $1 and consumed_at is null`,
    [reservationId],
  );
}

async function reconcile(c: Client, token: string, reservationId: string): Promise<string | null> {
  const { data, error } = await rpc<string>(c, "reconcile_manager_session_handoff", {
    p_token: token,
    p_reservation_id: reservationId,
  });
  if (error) throw new Error(`reconcile failed: ${error}`);
  return data;
}

// --- 1. upgrade from seeded legacy-invalid state -------------------------------

describe("R12-B: the cutover repairs legacy invalid bearer overlaps", () => {
  let db: TestDb;
  let c: Client;
  // invalid legacy states
  let overlapActive: { token: string; hash: string; reservationId: string };
  let overlapManagerTombstone: { token: string; hash: string; reservationId: string };
  let overlapPendingTombstone: { token: string; hash: string; reservationId: string };
  // states which must survive untouched
  let cleanPending: { token: string; hash: string; reservationId: string };
  let confirmedPair: { token: string; hash: string; reservationId: string; managerId: string };
  let confirmedThenRevoked: { token: string; hash: string; reservationId: string };
  let activeHolderId: string;

  beforeAll(async () => {
    db = await createTestDb("lime_p0_2_legacy_upgrade", { stopAfter: LEGACY_STOP });
    c = await db.client();
    const restaurantId = await seedRestaurant(c);
    const pendingOwnerId = await seedManager(c, restaurantId);
    activeHolderId = await seedManager(c, restaurantId);
    const pairManagerId = await seedManager(c, restaurantId);
    const revokedManagerId = await seedManager(c, restaurantId);

    // (a) unconfirmed pending whose hash is ALSO a live active session of
    //     another manager — a terminal-bearer resurrection waiting to happen.
    overlapActive = await mintPending(c, pendingOwnerId, "overlap-active");
    await c.query(
      `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '6 hours')`,
      [activeHolderId, restaurantId, overlapActive.hash],
    );

    // (b) unconfirmed pending whose bearer already has a terminal `manager`
    //     tombstone (its active session was revoked in the legacy world).
    overlapManagerTombstone = await mintPending(c, pendingOwnerId, "overlap-manager-tombstone");
    await c.query(
      `insert into public.revoked_session_tombstones (namespace, token_hash) values ('manager', $1)`,
      [overlapManagerTombstone.hash],
    );

    // (c) unconfirmed pending whose bearer already has a terminal
    //     `manager_pending` tombstone from a DIFFERENT reservation.
    overlapPendingTombstone = await mintPending(c, pendingOwnerId, "overlap-pending-tombstone");
    await c.query(
      `insert into public.revoked_session_tombstones (namespace, token_hash, pending_reservation_id)
       values ('manager_pending', $1, gen_random_uuid())`,
      [overlapPendingTombstone.hash],
    );

    // (d) an ordinary live unconfirmed handoff: must stay confirmable.
    cleanPending = await mintPending(c, pendingOwnerId, "clean-pending");

    // (e) the NORMAL end state: confirmed pending row + active session sharing
    //     the hash. Produced by the real legacy handshake, never seeded by hand.
    const pairToken = await mintActiveManagerSession(c, pairManagerId);
    confirmedPair = {
      token: pairToken,
      hash: sha256Hex(pairToken),
      reservationId: (
        await c.query<{ reservation_id: string }>(
          `select reservation_id from public.manager_pending_sessions where token_hash = $1`,
          [sha256Hex(pairToken)],
        )
      ).rows[0].reservation_id,
      managerId: pairManagerId,
    };

    // (f) a confirmed handoff whose active session was later revoked: the
    //     confirmed row now co-exists with a `manager` tombstone for its hash.
    //     That is legitimate history and must not be treated as an overlap.
    const revokedToken = await mintActiveManagerSession(c, revokedManagerId);
    confirmedThenRevoked = {
      token: revokedToken,
      hash: sha256Hex(revokedToken),
      reservationId: (
        await c.query<{ reservation_id: string }>(
          `select reservation_id from public.manager_pending_sessions where token_hash = $1`,
          [sha256Hex(revokedToken)],
        )
      ).rows[0].reservation_id,
    };
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: revokedToken })).data
        ?.verdict,
    ).toBe("REVOKED");

    // Now upgrade: R11 register + P0-1 lock order + this blocker's cutover.
    await applyMigrationsAfter(c, LEGACY_STOP);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
    await stopAll();
  });

  test.each([
    ["hash of a live active session", () => overlapActive],
    ["hash with a terminal manager tombstone", () => overlapManagerTombstone],
    ["hash with a terminal manager_pending tombstone", () => overlapPendingTombstone],
  ])("a legacy unconfirmed pending row sharing a %s is terminalized", async (_name, pick) => {
    const state = pick();
    expect(await pendingRow(c, state.hash)).toBeUndefined();
    // The permanent anti-reuse register keeps the bearer un-mintable forever.
    expect(await registered(c, state.hash)).toBe(true);
    expect((await tombstones(c, state.hash)).some((t) => t.namespace === "manager_pending")).toBe(
      true,
    );
    // Never PENDING or SUCCEEDED again, and never confirmable.
    expect(["FAILED", "UNKNOWN"]).toContain(await reconcile(c, state.token, state.reservationId));
    expect(
      await rpc<boolean>(c, "confirm_manager_session", {
        p_token: state.token,
        p_reservation_id: state.reservationId,
      }),
    ).toEqual({ data: false, error: null });
    expect(await pendingRow(c, state.hash)).toBeUndefined();
  });

  test("terminalizing records the exact hash + reservation pair", async () => {
    for (const state of [overlapActive, overlapManagerTombstone]) {
      expect(await tombstones(c, state.hash)).toEqual(
        expect.arrayContaining([
          { namespace: "manager_pending", pending_reservation_id: state.reservationId },
        ]),
      );
      expect(await reconcile(c, state.token, state.reservationId)).toBe("FAILED");
    }
    // The one case where the exact pair cannot be recorded: the hash already
    // carried a manager_pending tombstone from ANOTHER reservation, and
    // (namespace, token_hash) is unique. The row is still terminal and
    // un-mintable, and reconciliation answers UNKNOWN rather than PENDING.
    // Carrying the reservation identity for that case needs the durable
    // registry of blocker P1-5 and is deliberately out of scope here.
    expect((await tombstones(c, overlapPendingTombstone.hash)).map((t) => t.namespace)).toEqual([
      "manager_pending",
    ]);
    expect(
      await reconcile(c, overlapPendingTombstone.token, overlapPendingTombstone.reservationId),
    ).toBe("UNKNOWN");
  });

  test("the repair does not touch the active session that proved the overlap", async () => {
    expect(await activeSessionManager(c, overlapActive.hash)).toBe(activeHolderId);
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: overlapActive.token }))
        .data?.verdict,
    ).toBe("REVOKED");
  });

  test("a repaired bearer can never be minted again", async () => {
    const restaurantId = await seedRestaurant(c);
    const managerId = await seedManager(c, restaurantId);
    const reservationId = await reserve(c, "reuse-after-repair");
    expect(
      await rpc<boolean>(c, "create_manager_session_pending", {
        p_manager_id: managerId,
        p_reservation_id: reservationId,
        p_token: overlapManagerTombstone.token,
      }),
    ).toEqual({ data: false, error: null });
    expect(await pendingRow(c, overlapManagerTombstone.hash)).toBeUndefined();
  });

  test("a normal confirmed-pending + active pair is not misclassified", async () => {
    const row = await pendingRow(c, confirmedPair.hash);
    expect(row?.confirmed_at).not.toBeNull();
    expect(await activeSessionManager(c, confirmedPair.hash)).toBe(confirmedPair.managerId);
    expect(await reconcile(c, confirmedPair.token, confirmedPair.reservationId)).toBe("SUCCEEDED");
    expect(await tombstones(c, confirmedPair.hash)).toEqual([]);
  });

  test("a confirmed row whose active session was already revoked survives", async () => {
    const row = await pendingRow(c, confirmedThenRevoked.hash);
    expect(row?.confirmed_at).not.toBeNull();
    expect(await tombstones(c, confirmedThenRevoked.hash)).toEqual([
      { namespace: "manager", pending_reservation_id: null },
    ]);
    expect(await reconcile(c, confirmedThenRevoked.token, confirmedThenRevoked.reservationId)).toBe(
      "FAILED",
    );
  });

  test("an ordinary legacy handoff stays pending and still confirms", async () => {
    expect((await pendingRow(c, cleanPending.hash))?.confirmed_at).toBeNull();
    expect(await registered(c, cleanPending.hash)).toBe(true);
    expect(await tombstones(c, cleanPending.hash)).toEqual([]);
    // The 60s handoff/reservation TTLs are refreshed so this assertion measures
    // the cutover's classification, not how long the suite above took to run.
    await refreshHandoffTtl(c, cleanPending.hash, cleanPending.reservationId);
    expect(await reconcile(c, cleanPending.token, cleanPending.reservationId)).toBe("PENDING");
    expect(
      await rpc<boolean>(c, "confirm_manager_session", {
        p_token: cleanPending.token,
        p_reservation_id: cleanPending.reservationId,
      }),
    ).toEqual({ data: true, error: null });
    expect(await reconcile(c, cleanPending.token, cleanPending.reservationId)).toBe("SUCCEEDED");
  });

  test("the cutover persists hashes only, never a raw bearer", async () => {
    const raw = [
      overlapActive.token,
      overlapManagerTombstone.token,
      overlapPendingTombstone.token,
      cleanPending.token,
    ];
    for (const table of [
      "public.manager_pending_sessions",
      "public.manager_sessions",
      "public.revoked_session_tombstones",
      "public.manager_bearer_lifecycle_hashes",
    ]) {
      const hit = await c.query(`select 1 from ${table} where token_hash = any($1::text[])`, [raw]);
      expect(hit.rowCount, table).toBe(0);
    }
  });
});

// --- 2. cutover locking --------------------------------------------------------

describe("R12-B: the cutover locks the lifecycle tables", () => {
  let db: TestDb;
  let c: Client;

  beforeAll(async () => {
    db = await createTestDb("lime_p0_2_cutover_lock", { stopAfter: PRE_CUTOVER_STOP });
    c = await db.client();
  }, 600_000);

  afterAll(async () => {
    await db?.close();
    await stopAll();
  });

  test("the migration takes ACCESS EXCLUSIVE on all four lifecycle tables", () => {
    expect(migrationFiles()).toContain(CUTOVER);
    for (const table of [
      "public.manager_pending_sessions",
      "public.manager_sessions",
      "public.revoked_session_tombstones",
      "public.manager_bearer_lifecycle_hashes",
    ]) {
      expect(LOCK_STATEMENT).toContain(table);
    }
    expect(LOCK_STATEMENT.endsWith("in access exclusive mode;")).toBe(true);
  });

  test("it fails closed when applied without a transaction holding those locks", async () => {
    // Autocommit: `lock table` cannot outlive its statement, so the proof block
    // must abort the cutover instead of repairing under no protection at all.
    const { error } = await (async () => {
      try {
        await c.query(LOCK_PROOF_BLOCK);
        return { error: null };
      } catch (e) {
        return { error: (e as Error).message };
      }
    })();
    expect(error).toContain("MANAGER_LIFECYCLE_CUTOVER_NOT_LOCKED");
  });

  test("an in-flight legacy lifecycle write cannot interleave with the repair", async () => {
    const restaurantId = await seedRestaurant(c);
    const activeHolderId = await seedManager(c, restaurantId);
    const legacyOwnerId = await seedManager(c, restaurantId);
    // A live bearer that already owns its hash (legacy active row)...
    const token = rawHexToken();
    const hash = sha256Hex(token);
    await c.query(
      `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '6 hours')`,
      [activeHolderId, restaurantId, hash],
    );
    const reservationId = await reserve(c, "cutover-race");

    const writer = await connect(db.connectionString);
    const migrator = await connect(db.connectionString);
    let writerOpen = false;
    try {
      // ...and a legacy transaction which is STILL RUNNING the pre-R11 lifecycle
      // and is about to commit an overlapping unconfirmed pending row for it.
      await writer.query("begin");
      writerOpen = true;
      await writer.query(
        `insert into public.manager_pending_sessions
           (manager_id, restaurant_id, token_hash, reservation_id, expires_at)
         values ($1, $2, $3, $4, clock_timestamp() + interval '60 seconds')`,
        [legacyOwnerId, restaurantId, hash, reservationId],
      );

      const migratorPid = Number(
        (await migrator.query<{ pid: number }>(`select pg_backend_pid() as pid`)).rows[0].pid,
      );
      let migrationSettled = false;
      const migrating = migrator.query(CUTOVER_SQL).then(
        (r) => {
          migrationSettled = true;
          return r;
        },
        (e) => {
          migrationSettled = true;
          throw e;
        },
      );

      // Observed, not slept on: the migration is queued on an ungranted
      // relation lock behind the writer's uncommitted row.
      let waiting = false;
      for (let attempt = 0; attempt < 600 && !waiting; attempt += 1) {
        waiting =
          (
            await c.query<{ waiting: boolean }>(
              `select exists (select 1 from pg_locks l where l.pid = $1
                       and l.locktype = 'relation' and not l.granted) as waiting`,
              [migratorPid],
            )
          ).rows[0]?.waiting === true;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      expect(migrationSettled).toBe(false);

      await writer.query("commit");
      writerOpen = false;
      await expect(migrating).resolves.toEqual(expect.anything());

      // The row the legacy writer committed a moment before the cutover was
      // still inspected and terminalized, and the live bearer is untouched.
      expect(await pendingRow(c, hash)).toBeUndefined();
      expect(await activeSessionManager(c, hash)).toBe(activeHolderId);
      expect(await registered(c, hash)).toBe(true);
      expect(await tombstones(c, hash)).toEqual([
        { namespace: "manager_pending", pending_reservation_id: reservationId },
      ]);
      expect(await reconcile(c, token, reservationId)).toBe("FAILED");
    } finally {
      if (writerOpen) await writer.query("rollback").catch(() => undefined);
      await Promise.all([writer.end(), migrator.end()]);
    }
  }, 120_000);

  test("re-applying the cutover is a no-op", async () => {
    const before = await c.query(
      `select (select count(*) from public.manager_pending_sessions) as pending,
              (select count(*) from public.manager_sessions) as active,
              (select count(*) from public.revoked_session_tombstones) as tombstones,
              (select count(*) from public.manager_bearer_lifecycle_hashes) as registered`,
    );
    await c.query("begin");
    await c.query(CUTOVER_SQL);
    await c.query("commit");
    const after = await c.query(
      `select (select count(*) from public.manager_pending_sessions) as pending,
              (select count(*) from public.manager_sessions) as active,
              (select count(*) from public.revoked_session_tombstones) as tombstones,
              (select count(*) from public.manager_bearer_lifecycle_hashes) as registered`,
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});

// --- 3. independent runtime enforcement ----------------------------------------

describe("R12-B: retry, confirmation and reconciliation each refuse an overlap", () => {
  // Full migration chain, replayed from an empty database.
  let db: TestDb;
  let c: Client;
  let restaurantId: string;

  beforeAll(async () => {
    db = await createTestDb("lime_p0_2_runtime_guard");
    c = await db.client();
    restaurantId = await seedRestaurant(c);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
    await stopAll();
  });

  async function reservationState(
    reservationId: string,
  ): Promise<{ consumed_at: string | null; outcome: string | null }> {
    return (
      await c.query<{ consumed_at: string | null; outcome: string | null }>(
        `select consumed_at, outcome from public.owner_login_rate_limit_reservations where id = $1`,
        [reservationId],
      )
    ).rows[0];
  }

  /** Gives `hash` to a second manager's active session, i.e. exactly the
   * privileged/legacy overlap the cutover repairs — here created AFTER the
   * cutover so the runtime guards are what has to catch it. */
  async function giveHashToAnotherActiveSession(hash: string): Promise<string> {
    const holderId = await seedManager(c, restaurantId);
    await c.query(
      `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
       values ($1, $2, $3, now() + interval '6 hours')`,
      [holderId, restaurantId, hash],
    );
    return holderId;
  }

  test("the exact retry refuses an overlapping bearer and terminalizes it", async () => {
    const managerId = await seedManager(c, restaurantId);
    const pending = await mintPending(c, managerId, "runtime-retry");
    const holderId = await giveHashToAnotherActiveSession(pending.hash);

    expect(
      await rpc<boolean>(c, "create_manager_session_pending", {
        p_manager_id: managerId,
        p_reservation_id: pending.reservationId,
        p_token: pending.token,
      }),
    ).toEqual({ data: false, error: null });
    expect(await pendingRow(c, pending.hash)).toBeUndefined();
    expect(await tombstones(c, pending.hash)).toEqual([
      { namespace: "manager_pending", pending_reservation_id: pending.reservationId },
    ]);
    expect(await reconcile(c, pending.token, pending.reservationId)).toBe("FAILED");
    // The other lifecycle's live bearer and the reservation are untouched.
    expect(await activeSessionManager(c, pending.hash)).toBe(holderId);
    expect(await reservationState(pending.reservationId)).toEqual({
      consumed_at: null,
      outcome: null,
    });
  });

  test("confirmation refuses a bearer with a terminal manager tombstone", async () => {
    const managerId = await seedManager(c, restaurantId);
    const pending = await mintPending(c, managerId, "runtime-confirm");
    await c.query(
      `insert into public.revoked_session_tombstones (namespace, token_hash) values ('manager', $1)`,
      [pending.hash],
    );

    expect(
      await rpc<boolean>(c, "confirm_manager_session", {
        p_token: pending.token,
        p_reservation_id: pending.reservationId,
      }),
    ).toEqual({ data: false, error: null });
    // No session was activated, the row is terminal, and the reservation was
    // NOT consumed by the refusal.
    expect(await activeSessionManager(c, pending.hash)).toBeUndefined();
    expect(await pendingRow(c, pending.hash)).toBeUndefined();
    expect(await tombstones(c, pending.hash)).toEqual(
      expect.arrayContaining([
        { namespace: "manager_pending", pending_reservation_id: pending.reservationId },
      ]),
    );
    expect(await reservationState(pending.reservationId)).toEqual({
      consumed_at: null,
      outcome: null,
    });
    expect(await reconcile(c, pending.token, pending.reservationId)).toBe("FAILED");
  });

  test("reconciliation never reports an overlapping live row as PENDING", async () => {
    const managerId = await seedManager(c, restaurantId);
    const pending = await mintPending(c, managerId, "runtime-reconcile");
    await giveHashToAnotherActiveSession(pending.hash);

    // The row is still live at this point: only the classification is
    // fail-closed, so the client cannot be told to keep waiting for a handoff
    // that can never be confirmed.
    expect((await pendingRow(c, pending.hash))?.confirmed_at).toBeNull();
    expect(await reconcile(c, pending.token, pending.reservationId)).toBe("FAILED");
  });

  test("a clean handoff still mints, retries idempotently, confirms and reconciles", async () => {
    const managerId = await seedManager(c, restaurantId);
    const pending = await mintPending(c, managerId, "runtime-clean");
    // Deterministic exact retry of a valid live row keeps returning true.
    expect(
      await rpc<boolean>(c, "create_manager_session_pending", {
        p_manager_id: managerId,
        p_reservation_id: pending.reservationId,
        p_token: pending.token,
      }),
    ).toEqual({ data: true, error: null });
    expect((await pendingRow(c, pending.hash))?.confirmed_at).toBeNull();
    expect(await reconcile(c, pending.token, pending.reservationId)).toBe("PENDING");

    expect(
      await rpc<boolean>(c, "confirm_manager_session", {
        p_token: pending.token,
        p_reservation_id: pending.reservationId,
      }),
    ).toEqual({ data: true, error: null });
    expect(await activeSessionManager(c, pending.hash)).toBe(managerId);
    // Idempotent re-confirm of the completed handoff is still true, and the
    // confirmed row + its active session are not mistaken for an overlap.
    expect(
      await rpc<boolean>(c, "confirm_manager_session", {
        p_token: pending.token,
        p_reservation_id: pending.reservationId,
      }),
    ).toEqual({ data: true, error: null });
    expect(await reconcile(c, pending.token, pending.reservationId)).toBe("SUCCEEDED");
    expect(await reservationState(pending.reservationId)).toMatchObject({ outcome: "succeeded" });
  });

  test("supersede-on-confirm still revokes the manager's previous bearer", async () => {
    const managerId = await seedManager(c, restaurantId);
    const first = await mintActiveManagerSession(c, managerId);
    const second = await mintActiveManagerSession(c, managerId);
    expect(await activeSessionManager(c, sha256Hex(second))).toBe(managerId);
    expect(await activeSessionManager(c, sha256Hex(first))).toBeUndefined();
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: first })).data?.verdict,
    ).toBe("ALREADY_INACTIVE");
  });

  test("the overlap guard and the replaced RPCs keep their locked-down contract", async () => {
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
       where n.nspname = 'public' and p.proname = any($1::text[])
       order by p.proname`,
      [
        [
          "confirm_manager_session",
          "create_manager_session_pending",
          "manager_bearer_hash_conflict",
          "reconcile_manager_session_handoff",
        ],
      ],
    );
    expect(rows.rows.map((r) => r.name)).toEqual([
      "confirm_manager_session",
      "create_manager_session_pending",
      "manager_bearer_hash_conflict",
      "reconcile_manager_session_handoff",
    ]);
    for (const row of rows.rows) {
      expect(row.prosecdef, row.name).toBe(true);
      expect(row.config?.join(","), row.name).toContain("search_path=pg_catalog, public");
      expect(row.anon, row.name).toBe(false);
      expect(row.authenticated, row.name).toBe(false);
      // The internal overlap helper is not callable by any client role.
      expect(row.service, row.name).toBe(row.name !== "manager_bearer_hash_conflict");
    }
  });
});
