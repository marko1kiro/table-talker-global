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
  await c.query(`delete from public.manager_bearer_lifecycle_hashes`);
  await c.query(`delete from public.owner_login_rate_limit_reservations`);
  await c.query(`delete from public.owner_login_rate_limit_buckets`);
  // Last: the deletes above fire the P1-5 terminal-evidence triggers.
  await c.query(`delete from public.manager_handoff_reconciliation_registry`);
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

async function mintPendingFor(
  managerId: string,
  key: string,
): Promise<{ token: string; reservationId: string }> {
  const c = await db.client();
  const token = rawHexToken();
  const reservationId = await reserve(key);
  const minted = await rpc<boolean>(c, "create_manager_session_pending", {
    p_manager_id: managerId,
    p_reservation_id: reservationId,
    p_token: token,
  });
  expect(minted).toMatchObject({ data: true, error: null });
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

/** P1-5 durable exact evidence. The registry table is intentionally absent
 * until the P1-5 forward migration lands, so every lookup through this helper
 * fails RED. */
async function registry(
  token: string,
  reservationId: string,
): Promise<{ state: string; manager_id: string } | undefined> {
  const c = await db.client();
  const rows = (
    await c.query<{ state: string; manager_id: string }>(
      `select state, manager_id from public.manager_handoff_reconciliation_registry
       where token_hash = $1 and reservation_id = $2`,
      [sha256Hex(token), reservationId],
    )
  ).rows;
  return rows[0];
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

  test("an active hash cannot be repurposed as pending, before or after revoke", async () => {
    const c = await db.client();
    const active = await mintPending("active-global-identity");
    expect(
      (
        await rpc<boolean>(c, "confirm_manager_session", {
          p_token: active.token,
          p_reservation_id: active.reservationId,
        })
      ).data,
    ).toBe(true);
    const secondReservationId = await reserve("active-global-identity-second");
    expect(
      await rpc<boolean>(c, "create_manager_session_pending", {
        p_manager_id: MANAGER_ID,
        p_reservation_id: secondReservationId,
        p_token: active.token,
      }),
    ).toMatchObject({ data: false, error: null });
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: active.token })).data
        ?.verdict,
    ).toBe("REVOKED");
    expect(
      await rpc<boolean>(c, "create_manager_session_pending", {
        p_manager_id: MANAGER_ID,
        p_reservation_id: secondReservationId,
        p_token: active.token,
      }),
    ).toMatchObject({ data: false, error: null });
  });

  test("confirm holds reservation then pending rows, so a reservation cascade waits without inversion", async () => {
    const c = await db.client();
    const pending = await mintPending("parent-row-lock-order");
    const blocker = await connect(db.connectionString);
    const confirmer = await connect(db.connectionString);
    const parent = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      // This test-only trigger pauses after confirm has acquired reservation and
      // pending locks, exposing the historically inverted parent cascade path.
      await c.query(`create or replace function public.test_confirm_barrier() returns trigger
        language plpgsql as $$ begin perform pg_advisory_xact_lock(991, 1); return new; end $$`);
      await c.query(`create trigger test_confirm_barrier before update of confirmed_at
        on public.manager_pending_sessions for each row execute function public.test_confirm_barrier()`);
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query("select pg_advisory_xact_lock(991, 1)");
      const confirmPid = Number(
        (await confirmer.query("select pg_backend_pid() as pid")).rows[0]?.pid,
      );
      const confirming = rpc<boolean>(confirmer, "confirm_manager_session", {
        p_token: pending.token,
        p_reservation_id: pending.reservationId,
      });
      await waitForAdvisoryWait(c, confirmPid);
      const deleting = parent.query(
        `delete from public.owner_login_rate_limit_reservations where id = $1`,
        [pending.reservationId],
      );
      // The parent is blocked on the canonical reservation row, not a reverse
      // advisory request.  Releasing confirm must allow both transactions out.
      await new Promise((resolve) => setTimeout(resolve, 25));
      await blocker.query("commit");
      blockerOpen = false;
      expect(await confirming).toMatchObject({ data: true, error: null });
      await expect(deleting).resolves.toEqual(expect.anything());
      expect(
        await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [
          sha256Hex(pending.token),
        ]),
      ).toMatchObject({ rowCount: 1 });
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await c.query(
        `drop trigger if exists test_confirm_barrier on public.manager_pending_sessions`,
      );
      await c.query(`drop function if exists public.test_confirm_barrier()`);
      await Promise.all([blocker.end(), confirmer.end(), parent.end()]);
    }
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

  test("pending terminal evidence and the minimal anti-reuse registry are permanent", async () => {
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
    // No operational cleanup may reopen reuse, even after the reservation is
    // gone.  The permanent minimal registry is intentionally service-private.
    const whileReservationLives = await rpc<number>(c, "cleanup_manager_pending_tombstones", {
      p_before: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(whileReservationLives).toMatchObject({ data: 0, error: null });
    await c.query(`delete from public.owner_login_rate_limit_reservations where id = $1`, [
      pending.reservationId,
    ]);
    const retained = await rpc<number>(c, "cleanup_manager_pending_tombstones", {
      p_before: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    expect(retained).toMatchObject({ data: 0, error: null });
    expect(
      await c.query(`select 1 from public.manager_bearer_lifecycle_hashes where token_hash = $1`, [
        sha256Hex(pending.token),
      ]),
    ).toMatchObject({ rowCount: 1 });
  });

  test("manager and restaurant parent cascades wait behind confirmation and leave terminal evidence", async () => {
    const c = await db.client();
    const restaurantId = "33333333-3333-4333-8333-333333333333";
    const managerId = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
    await c.query(
      `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
       values ($1, 'RESTO-3', 'Resto Tiga', encode(extensions.digest('pin-resto-3', 'sha256'), 'hex'), now())`,
      [restaurantId],
    );
    await c.query(
      `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
       values ($1, 'cascade.tiga', 'Cascade Tiga', $2, $3, 'aktif')`,
      [managerId, restaurantId, await scryptHash("pw")],
    );
    const pending = await mintPendingFor(managerId, "manager-restaurant-cascade");
    const blocker = await connect(db.connectionString);
    const confirmer = await connect(db.connectionString);
    const parent = await connect(db.connectionString);
    let blockerOpen = false;
    try {
      await c.query(`create or replace function public.test_confirm_parent_barrier() returns trigger
        language plpgsql as $$ begin perform pg_advisory_xact_lock(991, 2); return new; end $$`);
      await c.query(`create trigger test_confirm_parent_barrier before update of confirmed_at
        on public.manager_pending_sessions for each row execute function public.test_confirm_parent_barrier()`);
      await blocker.query("begin");
      blockerOpen = true;
      await blocker.query("select pg_advisory_xact_lock(991, 2)");
      const confirmPid = Number(
        (await confirmer.query("select pg_backend_pid() as pid")).rows[0]?.pid,
      );
      const confirming = rpc<boolean>(confirmer, "confirm_manager_session", {
        p_token: pending.token,
        p_reservation_id: pending.reservationId,
      });
      await waitForAdvisoryWait(c, confirmPid);
      // DELETE restaurant cascades through manager_accounts and both manager
      // session tables. It must wait on confirmation's restaurant parent lock,
      // not form a child/parent cycle.
      const deleting = parent.query(`delete from public.restaurants where id = $1`, [restaurantId]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await blocker.query("commit");
      blockerOpen = false;
      expect(await confirming).toMatchObject({ data: true, error: null });
      await expect(deleting).resolves.toEqual(expect.anything());
      expect(
        (
          await c.query(`select 1 from public.manager_sessions where token_hash = $1`, [
            sha256Hex(pending.token),
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: pending.token })).data
          ?.verdict,
      ).toBe("ALREADY_INACTIVE");
    } finally {
      if (blockerOpen) await blocker.query("rollback").catch(() => undefined);
      await c.query(
        `drop trigger if exists test_confirm_parent_barrier on public.manager_pending_sessions`,
      );
      await c.query(`drop function if exists public.test_confirm_parent_barrier()`);
      await Promise.all([blocker.end(), confirmer.end(), parent.end()]);
    }
  });

  test("every R9/R11 SECURITY DEFINER lifecycle function has the intended service-only grant", async () => {
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
          "lock_manager_handoff_parent_rows",
          "tombstone_manager_active_delete",
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
    expect(rows.rows).toHaveLength(20);
    for (const row of rows.rows) {
      expect(row.prosecdef).toBe(true);
      expect(row.anon).toBe(false);
      expect(row.authenticated).toBe(false);
      expect(row.service).toBe(
        ![
          "lock_session_lifecycle_hash",
          "lock_manager_session_lifecycle",
          "lock_staff_session_lifecycle",
          "lock_manager_handoff_parent_rows",
          "tombstone_manager_active_delete",
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

  test("neither pending, active, tombstone, nor anti-reuse rows store the raw bearer", async () => {
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
      await c.query(`select 1 from public.manager_bearer_lifecycle_hashes where token_hash = $1`, [
        token,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(
      await c.query(`select 1 from public.manager_bearer_lifecycle_hashes where token_hash = $1`, [
        hash,
      ]),
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

describe("P1-5: durable exact reconciliation registry", () => {
  let p15Seq = 0;

  /** Fresh restaurant+manager pair per cascade test: the cascade itself is
   * what deletes the parents, so the fixture can never be shared. */
  async function seedCascadePair(): Promise<string> {
    const c = await db.client();
    p15Seq += 1;
    const suffix = String(p15Seq).padStart(2, "0");
    const restaurantId = `77777777-7777-4777-8777-7777777777${suffix}`;
    const managerId = `88888888-8888-4888-8888-8888888888${suffix}`;
    await c.query(
      `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
       values ($1, $2, $3, encode(extensions.digest($4, 'sha256'), 'hex'), now())`,
      [restaurantId, `RESTO-P15-${suffix}`, `Resto P15 ${suffix}`, `p15-pin-${suffix}`],
    );
    await c.query(
      `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
       values ($1, $2, 'P15 Cascade', $3, $4, 'aktif')`,
      [managerId, `p15.cascade.${suffix}`, restaurantId, await scryptHash("pw")],
    );
    return managerId;
  }

  async function reconcile(token: string, reservationId: string): Promise<string | null> {
    const c = await db.client();
    const { data, error } = await rpc<string>(c, "reconcile_manager_session_handoff", {
      p_token: token,
      p_reservation_id: reservationId,
    });
    if (error) throw new Error(`reconcile failed: ${error}`);
    return data;
  }

  async function confirm(token: string, reservationId: string): Promise<void> {
    const c = await db.client();
    expect(
      (
        await rpc<boolean>(c, "confirm_manager_session", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe(true);
  }

  test("mint records exact PENDING evidence for the (hash, reservation) pair", async () => {
    const { token, reservationId } = await mintPending("p15-mint-pending");
    expect(await registry(token, reservationId)).toMatchObject({
      state: "PENDING",
      manager_id: MANAGER_ID,
    });
    expect(await reconcile(token, reservationId)).toBe("PENDING");
  });

  test("confirm records exact SUCCEEDED evidence", async () => {
    const { token, reservationId } = await mintPending("p15-confirm-succeeded");
    await confirm(token, reservationId);
    expect(await registry(token, reservationId)).toMatchObject({
      state: "SUCCEEDED",
      manager_id: MANAGER_ID,
    });
    expect(await reconcile(token, reservationId)).toBe("SUCCEEDED");
  });

  test("revoking the active session leaves exact FAILED evidence", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-active-revoke");
    await confirm(token, reservationId);
    expect(
      (await rpc<Verdict>(c, "revoke_manager_session_by_token", { p_token: token })).data?.verdict,
    ).toBe("REVOKED");
    expect(await registry(token, reservationId)).toMatchObject({ state: "FAILED" });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("pending cleanup leaves exact FAILED evidence", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-cleanup-failed");
    expect(
      (
        await rpc<boolean>(c, "cleanup_pending_manager_session", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe(true);
    expect(await registry(token, reservationId)).toMatchObject({ state: "FAILED" });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("manager account cascade preserves exact terminal FAILED evidence", async () => {
    const c = await db.client();
    const managerId = await seedCascadePair();
    const { token, reservationId } = await mintPendingFor(managerId, "p15-manager-cascade");
    await confirm(token, reservationId);
    await c.query(`delete from public.manager_accounts where id = $1`, [managerId]);
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [
        sha256Hex(token),
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(await registry(token, reservationId)).toMatchObject({
      state: "FAILED",
      manager_id: managerId,
    });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("restaurant cascade preserves exact terminal FAILED evidence", async () => {
    const c = await db.client();
    const managerId = await seedCascadePair();
    const { token, reservationId } = await mintPendingFor(managerId, "p15-restaurant-cascade");
    await confirm(token, reservationId);
    const restaurantId = (
      await c.query<{ restaurant_id: string }>(
        `select restaurant_id from public.manager_accounts where id = $1`,
        [managerId],
      )
    ).rows[0].restaurant_id;
    await c.query(`delete from public.restaurants where id = $1`, [restaurantId]);
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [
        sha256Hex(token),
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(await registry(token, reservationId)).toMatchObject({
      state: "FAILED",
      manager_id: managerId,
    });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("TTL expiry terminalization records exact FAILED evidence", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-expiry-failed");
    await c.query(
      `update public.manager_pending_sessions set expires_at = now() - interval '1 second'
       where token_hash = $1`,
      [sha256Hex(token)],
    );
    const expired = await rpc<number>(c, "expire_manager_pending_sessions", {});
    expect(expired.error).toBeNull();
    expect(expired.data).toBe(1);
    expect(
      await c.query(`select 1 from public.manager_pending_sessions where token_hash = $1`, [
        sha256Hex(token),
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(await registry(token, reservationId)).toMatchObject({ state: "FAILED" });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("reservation retention preserves exact terminal FAILED evidence", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-retention-failed");
    await confirm(token, reservationId);
    await c.query(
      `update public.manager_sessions
       set expires_at = clock_timestamp() - interval '2 days'
       where token_hash = $1`,
      [sha256Hex(token)],
    );
    await c.query(
      `update public.owner_login_rate_limit_reservations
       set consumed_at = clock_timestamp() - interval '2 days'
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
    expect(
      await c.query(`select 1 from public.owner_login_rate_limit_reservations where id = $1`, [
        reservationId,
      ]),
    ).toMatchObject({ rowCount: 0 });
    expect(await registry(token, reservationId)).toMatchObject({ state: "FAILED" });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("tombstone retention preserves exact FAILED evidence once its reservation is gone", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-tombstone-retention");
    expect(
      (
        await rpc<boolean>(c, "cleanup_pending_manager_session", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe(true);
    // Age the tombstone safely past the 48h floor, then remove its reservation
    // so the operational cleanup is allowed to delete the tombstone itself.
    await c.query(
      `update public.revoked_session_tombstones
       set revoked_at = clock_timestamp() - interval '49 hours'
       where namespace = 'manager_pending' and token_hash = $1`,
      [sha256Hex(token)],
    );
    await c.query(`delete from public.owner_login_rate_limit_reservations where id = $1`, [
      reservationId,
    ]);
    const retained = await rpc<number>(c, "cleanup_manager_pending_tombstones", {
      p_before: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    });
    // The helper is fail-closed: it never deletes the tombstone. Either way the
    // exact registry row is the durable evidence: it must stay terminal FAILED
    // and reconciliation must not degrade to UNKNOWN.
    expect(retained).toMatchObject({ data: 0, error: null });
    expect((await pendingTombstone(token)).rows).toHaveLength(1);
    expect(await registry(token, reservationId)).toMatchObject({ state: "FAILED" });
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("the same hash with another reservation stays UNKNOWN with no registry row", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-wrong-pair");
    expect(
      (
        await rpc<boolean>(c, "cleanup_pending_manager_session", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe(true);
    const otherReservationId = crypto.randomUUID();
    expect(await registry(token, otherReservationId)).toBeUndefined();
    expect(await reconcile(token, otherReservationId)).toBe("UNKNOWN");
    expect(await reconcile(token, reservationId)).toBe("FAILED");
  });

  test("reconciliation stays a fixed-search_path service-only RPC", async () => {
    const c = await db.client();
    const rows = await c.query<{
      prosecdef: boolean;
      config: string[] | null;
      anon: boolean;
      authenticated: boolean;
      service: boolean;
    }>(
      `select p.prosecdef, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
              has_function_privilege('service_role', p.oid, 'EXECUTE') as service
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'reconcile_manager_session_handoff'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].prosecdef).toBe(true);
    expect(rows.rows[0].config?.join(",")).toContain("search_path=pg_catalog, public");
    expect(rows.rows[0]).toMatchObject({ anon: false, authenticated: false, service: true });
  });
});

// Task-3-ready security invariants. RED only while the registry is absent;
// they must stay green once the forward migration lands.
describe("P1-5 Task 3: registry security invariants", () => {
  test("the registry stores only the SHA-256 hash, never the raw bearer substring", async () => {
    const c = await db.client();
    const { token, reservationId } = await mintPending("p15-raw-bearer");
    expect(
      (
        await rpc<boolean>(c, "confirm_manager_session", {
          p_token: token,
          p_reservation_id: reservationId,
        })
      ).data,
    ).toBe(true);
    const hash = sha256Hex(token);
    const row = (
      await c.query<{ evidence: string }>(
        `select row_to_json(r)::text as evidence
         from public.manager_handoff_reconciliation_registry r
         where token_hash = $1 and reservation_id = $2`,
        [hash, reservationId],
      )
    ).rows[0]?.evidence;
    expect(row, "exact registry row must exist").toBeDefined();
    // Substring position check: the raw bearer may not appear anywhere in the
    // serialized row, while its SHA-256 hash must.
    expect(row.indexOf(token)).toBe(-1);
    expect(row.indexOf(hash)).toBeGreaterThan(-1);
  });

  test("the registry is RLS-enforced, policy-less, and service-private", async () => {
    const c = await db.client();
    const rows = await c.query<{
      relrowsecurity: boolean;
      policies: string;
      anon_select: boolean;
      authenticated_select: boolean;
      anon_insert: boolean;
      authenticated_insert: boolean;
    }>(
      `select r.relrowsecurity,
              (select count(*)::text from pg_policy p where p.polrelid = r.oid) as policies,
              has_table_privilege('anon', r.oid, 'SELECT') as anon_select,
              has_table_privilege('authenticated', r.oid, 'SELECT') as authenticated_select,
              has_table_privilege('anon', r.oid, 'INSERT') as anon_insert,
              has_table_privilege('authenticated', r.oid, 'INSERT') as authenticated_insert
       from pg_class r join pg_namespace n on n.oid = r.relnamespace
       where n.nspname = 'public' and r.relname = 'manager_handoff_reconciliation_registry'`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({
      relrowsecurity: true,
      policies: "0",
      anon_select: false,
      authenticated_select: false,
      anon_insert: false,
      authenticated_insert: false,
    });
  });
});
