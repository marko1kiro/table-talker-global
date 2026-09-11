// R9/R10 disposable-Postgres regression suite for authoritative manager pending lifecycle.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
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

let db: TestDb;
type Verdict = { verdict?: string };

beforeAll(async () => {
  db = await createTestDb("lime_pending_tombstone_lifecycle");
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
  await c.query(`delete from public.revoked_session_tombstones`);
  await c.query(`delete from public.owner_login_rate_limit_reservations`);
  await c.query(`delete from public.owner_login_rate_limit_buckets`);
});

async function reserve(key: string): Promise<string> {
  const c = await db.client();
  const result = await rpcRows<{ reservation_id: string }>(c, "reserve_owner_login_attempt", {
    p_client_bucket_hash: sha256Hex(`${key}:client`),
    p_ip_bucket_hash: sha256Hex(`${key}:ip`),
    p_attempt_key: `${key}-attempt-key-0123456789`,
  });
  const id = result.rows[0]?.reservation_id;
  if (!id) throw new Error(`reservation failed: ${result.error ?? "no id"}`);
  return id;
}

async function mintPending(key: string): Promise<{ token: string; reservationId: string }> {
  const c = await db.client();
  const token = rawHexToken();
  const reservationId = await reserve(key);
  const minted = await rpc<boolean>(c, "create_manager_session_pending", {
    p_manager_id: MANAGER_ID,
    p_reservation_id: reservationId,
    p_token: token,
  });
  expect(minted.error).toBeNull();
  expect(minted.data).toBe(true);
  return { token, reservationId };
}

async function pendingTombstone(token: string) {
  const c = await db.client();
  return c.query<{ token_hash: string; pending_reservation_id: string }>(
    `select token_hash, pending_reservation_id
     from public.revoked_session_tombstones
     where namespace = 'manager_pending' and token_hash = $1`,
    [sha256Hex(token)],
  );
}

async function waitForAdvisoryWait(c: Awaited<ReturnType<TestDb["client"]>>, pid: number) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await c.query<{ wait_event_type: string | null; advisory_wait: boolean }>(
      `select a.wait_event_type,
         exists (select 1 from pg_locks l where l.pid = a.pid
                 and l.locktype = 'advisory' and not l.granted) as advisory_wait
       from pg_stat_activity a where a.pid = $1`,
      [pid],
    );
    if (state.rows[0]?.wait_event_type === "Lock" && state.rows[0]?.advisory_wait) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} did not wait for lifecycle advisory lock`);
}

describe("R9/R10: authoritative pending-manager tombstone lifecycle", () => {
  test("live pending manager revoke terminates it and records manager_pending evidence", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("live-revoke");

    const revoked = await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token });
    expect(revoked.error).toBeNull();
    expect(revoked.data?.verdict).toBe("REVOKED");
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [
        sha256Hex(token),
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect((await pendingTombstone(token)).rows).toEqual([
      { token_hash: sha256Hex(token), pending_reservation_id: reservationId },
    ]);
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("ALREADY_INACTIVE");
  });

  test("cleanup is exact-pair, authoritative, and replay-safe", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("cleanup-replay");

    const first = await rpc<boolean>(c, "cleanup_pending_manager_session", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(true);
    expect((await pendingTombstone(token)).rows[0]?.pending_reservation_id).toBe(reservationId);

    const replay = await rpc<boolean>(c, "cleanup_pending_manager_session", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    expect(replay.data).toBe(true);
    const wrongPair = await rpc<boolean>(c, "cleanup_pending_manager_session", {
      p_token: token,
      p_reservation_id: "00000000-0000-4000-8000-000000000009",
    });
    expect(wrongPair.data).toBe(false);
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("ALREADY_INACTIVE");
  });

  test("TTL expiry turns an unconfirmed pending row into evidence before deletion", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("ttl-expiry");
    await c.query(
      `update public.manager_pending_sessions set expires_at = now() - interval '1 second'
       where token_hash = $1`,
      [sha256Hex(token)],
    );

    const expired = await rpc<number>(c, "expire_manager_pending_sessions", {});
    expect(expired.error).toBeNull();
    expect(expired.data).toBe(1);
    expect((await pendingTombstone(token)).rows[0]?.pending_reservation_id).toBe(reservationId);
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("ALREADY_INACTIVE");
    expect(
      (
        await rpc<string>(c, "reconcile_manager_session_handoff", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe("FAILED");
  });

  test("pending manager namespace is a staff kind mismatch before and after terminal replay", async () => {
    const c = await db.client();
    const { token } = await mintPending("namespace-mismatch");

    const liveMismatch = await rpc<Verdict>(c, "revoke_staff_session_by_token", {
      p_kind: "area_manager",
      p_token: token,
    });
    expect(liveMismatch.data?.verdict).toBe("KIND_MISMATCH");
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [
        sha256Hex(token),
      ]),
    ).toMatchObject({ rowCount: 1 });

    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("REVOKED");
    const tombstoneMismatch = await rpc<Verdict>(c, "revoke_staff_session_by_token", {
      p_kind: "super_admin",
      p_token: token,
    });
    expect(tombstoneMismatch.data?.verdict).toBe("KIND_MISMATCH");
  });

  test("cleanup and revoke tombstones reject a queued deterministic re-mint", async () => {
    const c = await db.client();
    for (const mode of ["cleanup", "revoke"] as const) {
      const pending = await mintPending(`terminal-remint-${mode}`);
      const blocker = await connect(db.connectionString);
      const terminalClient = await connect(db.connectionString);
      const minter = await connect(db.connectionString);
      let blockerOpen = false;
      try {
        await blocker.query("begin");
        blockerOpen = true;
        await blocker.query(`select public.lock_session_lifecycle_hash($1)`, [
          sha256Hex(pending.token),
        ]);
        const terminalPid = Number(
          (await terminalClient.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
        );
        const terminal =
          mode === "cleanup"
            ? rpc<boolean>(terminalClient, "cleanup_pending_manager_session", {
                p_token: pending.token,
                p_reservation_id: pending.reservationId,
              })
            : rpc<Verdict>(terminalClient, "revoke_manager_session_by_token", {
                p_token: pending.token,
              });
        await waitForAdvisoryWait(c, terminalPid);
        const remint = rpc<boolean>(minter, "create_manager_session_pending", {
          p_manager_id: MANAGER_ID,
          p_reservation_id: pending.reservationId,
          p_token: pending.token,
        });
        await blocker.query("commit");
        blockerOpen = false;
        const terminalResult = await terminal;
        expect(terminalResult.error).toBeNull();
        if (mode === "cleanup") expect(terminalResult.data).toBe(true);
        else expect((terminalResult.data as Verdict | null)?.verdict).toBe("REVOKED");
        expect(await remint).toMatchObject({ data: false, error: null });
      } finally {
        if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
        await Promise.all([blocker.end(), terminalClient.end(), minter.end()]);
      }
    }
  });

  test("confirm and revoke are serialized by the exact bearer lock", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("confirm-revoke-race");
    const tokenHash = sha256Hex(token);
    const blocker = await connect(db.connectionString);
    const revoker = await connect(db.connectionString);
    const confirmer = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query(`select public.lock_session_lifecycle_hash($1)`, [tokenHash]);
      const revokePid = Number(
        (await revoker.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const revoke = rpc<Verdict>(revoker, "revoke_manager_session_by_token", { p_token: token });
      await waitForAdvisoryWait(c, revokePid);
      const confirm = rpc<boolean>(confirmer, "confirm_manager_session", {
        p_token: token,
        p_reservation_id: reservationId,
      });
      await blocker.query("commit");
      blockerOpen = false;
      expect((await revoke).data?.verdict).toBe("REVOKED");
      expect(await confirm).toMatchObject({ data: false, error: null });
      expect(
        await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [tokenHash]),
      ).toMatchObject({ rowCount: 0 });
      expect((await pendingTombstone(token)).rows[0]?.pending_reservation_id).toBe(reservationId);
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await Promise.all([blocker.end(), revoker.end(), confirmer.end()]);
    }
  });

  test("reconciliation queued behind confirmation observes its complete committed snapshot", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("reconcile-confirm-race");
    const blocker = await connect(db.connectionString);
    const confirmer = await connect(db.connectionString);
    const reconciler = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query(`select public.lock_session_lifecycle_hash($1)`, [sha256Hex(token)]);
      const confirmPid = Number(
        (await confirmer.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const confirm = rpc<boolean>(confirmer, "confirm_manager_session", {
        p_token: token,
        p_reservation_id: reservationId,
      });
      await waitForAdvisoryWait(c, confirmPid);
      const reconcile = rpc<string>(reconciler, "reconcile_manager_session_handoff", {
        p_token: token,
        p_reservation_id: reservationId,
      });
      await blocker.query("commit");
      blockerOpen = false;
      expect(await confirm).toMatchObject({ data: true, error: null });
      expect(await reconcile).toMatchObject({ data: "SUCCEEDED", error: null });
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await Promise.all([blocker.end(), confirmer.end(), reconciler.end()]);
    }
  });

  test("reservation cascade records an exact pending tombstone before deleting its row", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("retention-cascade");
    await c.query(
      `update public.owner_login_rate_limit_reservations
       set expires_at = clock_timestamp() - interval '2 days'
       where id = $1`,
      [reservationId],
    );
    const retained = await rpc<{ reservations_deleted?: number }>(
      c,
      "cleanup_owner_login_rate_limits",
      {},
    );
    expect(retained.error).toBeNull();
    expect(retained.data?.reservations_deleted).toBeGreaterThanOrEqual(1);
    expect((await pendingTombstone(token)).rows).toEqual([
      { token_hash: sha256Hex(token), pending_reservation_id: reservationId },
    ]);
    expect(
      (
        await rpc<boolean>(c, "create_manager_session_pending", {
          p_manager_id: MANAGER_ID,
          p_reservation_id: reservationId,
          p_token: token,
        })
      ).data,
    ).toBe(false);
  });

  test("a terminal hash cannot be reused by a different reservation", async () => {
    const c = await db.client();
    const first = await mintPending("hash-identity-first");
    expect(
      (
        await rpc<boolean>(c, "cleanup_pending_manager_session", {
          p_token: first.token,
          p_reservation_id: first.reservationId,
        })
      ).data,
    ).toBe(true);
    const secondReservationId = await reserve("hash-identity-second");
    const reused = await rpc<boolean>(c, "create_manager_session_pending", {
      p_manager_id: MANAGER_ID,
      p_reservation_id: secondReservationId,
      p_token: first.token,
    });
    expect(reused).toMatchObject({ data: false, error: null });
    expect((await pendingTombstone(first.token)).rows).toEqual([
      { token_hash: sha256Hex(first.token), pending_reservation_id: first.reservationId },
    ]);
  });

  test("confirm and account-wide revoke wait on the manager hierarchy and cannot reproduce the old cycle", async () => {
    const c = await db.client();
    // Promote an old bearer so confirmation would have to revoke it.
    const old = await mintPending("cycle-old-active-confirm");
    expect(
      (
        await rpc<boolean>(c, "confirm_manager_session", {
          p_token: old.token,
          p_reservation_id: old.reservationId,
        })
      ).data,
    ).toBe(true);
    const next = await mintPending("cycle-new-pending");
    const blocker = await connect(db.connectionString);
    const confirmer = await connect(db.connectionString);
    const revoker = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query(`select public.lock_manager_session_lifecycle($1)`, [MANAGER_ID]);
      const confirmPid = Number(
        (await confirmer.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const revokePid = Number(
        (await revoker.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const confirming = rpc<boolean>(confirmer, "confirm_manager_session", {
        p_token: next.token,
        p_reservation_id: next.reservationId,
      });
      const revoking = rpc<number>(revoker, "revoke_manager_sessions", {
        p_manager_id: MANAGER_ID,
      });
      await waitForAdvisoryWait(c, confirmPid);
      await waitForAdvisoryWait(c, revokePid);
      await blocker.query("commit");
      blockerOpen = false;
      await expect(Promise.all([confirming, revoking])).resolves.toEqual([
        expect.objectContaining({ error: null }),
        expect.objectContaining({ error: null }),
      ]);
      expect(
        (await c.query(`select 1 from public.manager_sessions where manager_id = $1`, [MANAGER_ID]))
          .rowCount,
      ).toBe(0);
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await Promise.all([blocker.end(), confirmer.end(), revoker.end()]);
    }
  });

  test("retention and account-wide revoke serialize one manager's multiple pending hashes", async () => {
    const c = await db.client();
    const first = await mintPending("retention-multi-1");
    const second = await mintPending("retention-multi-2");
    await c.query(
      `update public.owner_login_rate_limit_reservations
                   set expires_at = clock_timestamp() - interval '2 days'
                   where id = any($1::uuid[])`,
      [[first.reservationId, second.reservationId]],
    );
    const blocker = await connect(db.connectionString);
    const retainer = await connect(db.connectionString);
    const revoker = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query(`select public.lock_manager_session_lifecycle($1)`, [MANAGER_ID]);
      const retentionPid = Number(
        (await retainer.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const revokePid = Number(
        (await revoker.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const retaining = rpc<{ reservations_deleted?: number }>(
        retainer,
        "cleanup_owner_login_rate_limits",
        {},
      );
      const revoking = rpc<number>(revoker, "revoke_manager_sessions", {
        p_manager_id: MANAGER_ID,
      });
      await waitForAdvisoryWait(c, retentionPid);
      await waitForAdvisoryWait(c, revokePid);
      await blocker.query("commit");
      blockerOpen = false;
      await expect(Promise.all([retaining, revoking])).resolves.toEqual([
        expect.objectContaining({ error: null }),
        expect.objectContaining({ error: null }),
      ]);
      expect(
        (
          await c.query(`select 1 from public.manager_pending_sessions where manager_id = $1`, [
            MANAGER_ID,
          ])
        ).rowCount,
      ).toBe(0);
      expect((await pendingTombstone(first.token)).rows[0]?.pending_reservation_id).toBe(
        first.reservationId,
      );
      expect((await pendingTombstone(second.token)).rows[0]?.pending_reservation_id).toBe(
        second.reservationId,
      );
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await Promise.all([blocker.end(), retainer.end(), revoker.end()]);
    }
  });

  test("concurrent confirmations for one manager wait at the same account lock and leave one active bearer", async () => {
    const c = await db.client();
    const first = await mintPending("confirm-same-manager-1");
    const second = await mintPending("confirm-same-manager-2");
    const blocker = await connect(db.connectionString);
    const one = await connect(db.connectionString);
    const two = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query(`select public.lock_manager_session_lifecycle($1)`, [MANAGER_ID]);
      const onePid = Number((await one.query(`select pg_backend_pid() as pid`)).rows[0]?.pid);
      const twoPid = Number((await two.query(`select pg_backend_pid() as pid`)).rows[0]?.pid);
      const firstConfirm = rpc<boolean>(one, "confirm_manager_session", {
        p_token: first.token,
        p_reservation_id: first.reservationId,
      });
      const secondConfirm = rpc<boolean>(two, "confirm_manager_session", {
        p_token: second.token,
        p_reservation_id: second.reservationId,
      });
      await waitForAdvisoryWait(c, onePid);
      await waitForAdvisoryWait(c, twoPid);
      await blocker.query("commit");
      blockerOpen = false;
      await expect(Promise.all([firstConfirm, secondConfirm])).resolves.toEqual([
        expect.objectContaining({ error: null }),
        expect.objectContaining({ error: null }),
      ]);
      expect(
        (await c.query(`select 1 from public.manager_sessions where manager_id = $1`, [MANAGER_ID]))
          .rowCount,
      ).toBe(1);
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await Promise.all([blocker.end(), one.end(), two.end()]);
    }
  });

  test("reservation cascade and confirmation both wait at the manager lock before cascade deletion", async () => {
    const c = await db.client();
    const pending = await mintPending("cascade-confirm-lock");
    await c.query(
      `update public.owner_login_rate_limit_reservations
                   set expires_at = clock_timestamp() - interval '2 days' where id = $1`,
      [pending.reservationId],
    );
    const blocker = await connect(db.connectionString);
    const confirmer = await connect(db.connectionString);
    const parent = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query(`select public.lock_manager_session_lifecycle($1)`, [MANAGER_ID]);
      const confirmPid = Number(
        (await confirmer.query(`select pg_backend_pid() as pid`)).rows[0]?.pid,
      );
      const confirming = rpc<boolean>(confirmer, "confirm_manager_session", {
        p_token: pending.token,
        p_reservation_id: pending.reservationId,
      });
      // Observe confirmation queued at M before the parent DELETE begins. An FK
      // cascade already holds its reservation/child-row locks when its trigger
      // fires, so the trigger intentionally does not take M or H afterward.
      await waitForAdvisoryWait(c, confirmPid);
      const cascading = parent.query(
        `delete from public.owner_login_rate_limit_reservations where id = $1`,
        [pending.reservationId],
      );
      await expect(cascading).resolves.toEqual(expect.anything());
      await blocker.query("commit");
      blockerOpen = false;
      await expect(confirming).resolves.toEqual(expect.objectContaining({ error: null }));
      expect((await pendingTombstone(pending.token)).rows[0]?.pending_reservation_id).toBe(
        pending.reservationId,
      );
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await Promise.all([blocker.end(), confirmer.end(), parent.end()]);
    }
  });

  test("explicit pending tombstone cleanup has no unsafe default and enforces its horizon", async () => {
    const c = await db.client();
    const pending = await mintPending("tombstone-retention");
    await rpc<boolean>(c, "cleanup_pending_manager_session", {
      p_token: pending.token,
      p_reservation_id: pending.reservationId,
    });
    const tooRecent = await rpc<number>(c, "cleanup_manager_pending_tombstones", {
      p_before: new Date().toISOString(),
    });
    expect(tooRecent.error).toContain("TOMBSTONE_CUTOFF_TOO_RECENT");
    await c.query(
      `update public.revoked_session_tombstones
                   set revoked_at = clock_timestamp() - interval '49 hours'
                   where namespace = 'manager_pending' and token_hash = $1`,
      [sha256Hex(pending.token)],
    );
    // A live exact reservation preserves reconciliation evidence even past
    // the conservative age floor; only an operationally removed reservation
    // permits explicit tombstone cleanup.
    const whileReservationLives = await rpc<number>(c, "cleanup_manager_pending_tombstones", {
      p_before: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(whileReservationLives).toMatchObject({ data: 0, error: null });
    await c.query(`delete from public.owner_login_rate_limit_reservations where id = $1`, [
      pending.reservationId,
    ]);
    const cleaned = await rpc<number>(c, "cleanup_manager_pending_tombstones", {
      p_before: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(cleaned).toMatchObject({ data: 1, error: null });
  });

  test("every R9/R10 SECURITY DEFINER lifecycle function has the intended service-only grant", async () => {
    const c = await db.client();
    const rows = await c.query<{
      name: string;
      prosecdef: boolean;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(
      `select p.proname as name, p.prosecdef,
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1::text[])
       order by p.proname`,
      [
        [
          "lock_session_lifecycle_hash",
          "lock_manager_session_lifecycle",
          "lock_staff_session_lifecycle",
          "tombstone_unconfirmed_manager_pending_delete",
          "expire_manager_pending_session_hash",
          "expire_manager_pending_sessions",
          "revoke_manager_active_sessions",
          "revoke_manager_sessions",
          "create_manager_session_pending",
          "confirm_manager_session",
          "cleanup_pending_manager_session",
          "revoke_manager_session_by_token",
          "revoke_staff_sessions",
          "revoke_staff_session_by_token",
          "reconcile_manager_session_handoff",
          "cleanup_owner_login_rate_limits",
          "cleanup_manager_pending_tombstones",
          "create_staff_session",
        ],
      ],
    );
    expect(rows.rows).toHaveLength(18);
    for (const row of rows.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.anon).toBe(false);
      expect(row.authenticated).toBe(false);
      expect(row.service).toBe(
        ![
          "lock_session_lifecycle_hash",
          "lock_manager_session_lifecycle",
          "lock_staff_session_lifecycle",
          "tombstone_unconfirmed_manager_pending_delete",
          "expire_manager_pending_session_hash",
          "revoke_manager_active_sessions",
        ].includes(row.name),
      );
    }
  });

  test("full migration replay leaves lifecycle RPCs service-only", async () => {
    const c = await db.client();
    const permissions = await c.query<{ anon: boolean; service: boolean; table_anon: boolean }>(
      `select
        has_function_privilege('anon',
          'public.create_manager_session_pending(uuid,uuid,text)'::regprocedure, 'EXECUTE') as anon,
        has_function_privilege('service_role',
          'public.create_manager_session_pending(uuid,uuid,text)'::regprocedure, 'EXECUTE') as service,
        has_table_privilege('anon', 'public.manager_pending_sessions', 'SELECT') as table_anon`,
    );
    expect(permissions.rows[0]).toEqual({ anon: false, service: true, table_anon: false });
  });

  test("neither pending, active, nor tombstone rows store the raw bearer", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("raw-token");
    const hash = sha256Hex(token);
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [token]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [hash]),
    ).toMatchObject({ rowCount: 1 });
    expect(
      (
        await rpc<boolean>(c, "confirm_manager_session", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe(true);
    expect(
      await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [token]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [hash]),
    ).toMatchObject({ rowCount: 1 });
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("REVOKED");
    expect(
      await c.query(`select 1 from public.revoked_session_tombstones where token_hash = $1`, [
        token,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await c.query(`select 1 from public.revoked_session_tombstones where token_hash = $1`, [
        hash,
      ]),
    ).toMatchObject({ rowCount: 1 });
  });
});
