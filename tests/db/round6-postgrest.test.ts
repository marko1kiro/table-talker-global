// R6-E: self-contained, digest-pinned PostgREST HTTP evidence.
// Replaces the R5 opt-in harness with one that is REQUIRED in CI:
//   - the PostgREST binary is pinned to v16.2 and verified against the
//     SHA-256 digests published on the GitHub release BEFORE it is executed
//     (supply-chain pin; no pre-placed binary is trusted);
//   - JWTs are real HMAC-SHA256 (the R5 harness signed with a bare sha256,
//     which is not a valid JWT signature);
//   - the HTTP port is dynamically allocated (no fixed 3099 collisions);
//   - the FULL migration chain is replayed through the shared disposable-DB
//     harness (never a hand-picked partial list).
// Gating: GitHub Actions sets CI=true, so this suite ALWAYS runs there.
// Locally it is opt-in (POSTGREST_EVIDENCE=1): the pinned Windows binary
// needs a VC++ runtime component this dev machine cannot load.
// Realtime (WebSocket) evidence remains DB-level only — the embedded stack
// has no Realtime server; reported honestly in the round report.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestDb } from "./harness";
import { createTestDb, stopAll, type LegacySeed } from "./harness";
import { startPostgrestHarness, type PostgrestHandle } from "./postgrest-harness";

const RUN = process.env.CI === "true" || process.env.POSTGREST_EVIDENCE === "1";

const R1 = "11111111-1111-4111-8111-111111111111";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const AM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const seedLegacy: LegacySeed = async (c) => {
  await c.query(
    `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at)
     values ($1, 'RESTO-1', 'Resto Satu', encode(extensions.digest('pin-e', 'sha256'), 'hex'), now())`,
    [R1],
  );
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, 'budi.santoso', 'Budi Santoso', $2, 'oldsalt:oldhash', 'aktif')`,
    [MANAGER_ID, R1],
  );
  await c.query(
    `insert into public.area_manager_accounts (id, staff_id, full_name, password_hash, status, password_changed_at)
     values ($1, 'am.satu', 'AM Satu', 'oldsalt:oldhash', 'aktif', now())`,
    [AM_ID],
  );
};

let db: TestDb;
let pgrst: PostgrestHandle;
let dbClient: Awaited<ReturnType<TestDb["client"]>>;

beforeAll(async () => {
  if (!RUN) return;
  db = await createTestDb("lime_r6_postgrest", { seedLegacy });
  dbClient = await db.client();
  pgrst = await startPostgrestHarness(db.connectionString);
}, 600_000);

afterAll(async () => {
  if (!RUN) return;
  await pgrst?.stop();
  await db?.close();
  await stopAll();
});

async function rpcPost(
  fn: string,
  body: Record<string, unknown>,
  jwt?: string,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`${pgrst.url}/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // non-JSON error body (e.g. PGRST202 html/text)
  }
  return { status: res.status, json, text };
}

const service = () => pgrst.jwt({ role: "service_role", sub: "r6-evidence" });

describe.skipIf(!RUN)("R6-E: PostgREST HTTP evidence (digest-pinned, required in CI)", () => {
  it("anon: no JWT -> 401 permission denied", async () => {
    const r = await rpcPost("get_manager_credential", { p_id_manager: "budi.santoso" });
    expect(r.status).toBe(401);
  });

  it("service_role with a real HMAC-SHA256 JWT -> 200", async () => {
    const r = await rpcPost("get_manager_credential", { p_id_manager: "nobody" }, service());
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json) || r.json === null).toBe(true);
  });

  it("wrong parameter name -> PostgREST PGRST202 (404)", async () => {
    const r = await rpcPost("get_manager_credential", { p_wrong: "x" }, service());
    expect(r.status).toBe(404);
    expect(r.text).toContain("PGRST202");
  });

  it("manager handshake over HTTP: pending -> confirm -> resolve -> revoke verdict", async () => {
    const mint = await rpcPost(
      "create_manager_session_pending",
      { p_manager_id: MANAGER_ID },
      service(),
    );
    expect(mint.status).toBe(200);
    const token = mint.json as string;
    expect(typeof token).toBe("string");

    const confirm = await rpcPost("confirm_manager_session", { p_token: token }, service());
    expect(confirm.status).toBe(200);
    expect(confirm.json).toBe(true);

    const resolve = await rpcPost("get_manager_id_by_token", { p_token: token }, service());
    expect(resolve.status).toBe(200);
    expect(resolve.json).toBe(MANAGER_ID);

    const revoke = await rpcPost("revoke_manager_session_by_token", { p_token: token }, service());
    expect(revoke.status).toBe(200);
    expect(revoke.json).toEqual({ verdict: "REVOKED" });

    const dead = await rpcPost("get_manager_id_by_token", { p_token: token }, service());
    expect(dead.json).toBeNull();
  });

  it("AM flow over HTTP: credential -> session -> revoke -> ALREADY_INACTIVE verdict", async () => {
    const cred = await rpcPost("get_area_manager_credential", { p_staff_id: "am.satu" }, service());
    expect(cred.status).toBe(200);
    const account = (Array.isArray(cred.json) ? cred.json[0] : cred.json) as {
      id: string;
      status: string;
    };
    expect(account?.id).toBe(AM_ID);
    expect(account?.status).toBe("aktif");

    const mint = await rpcPost(
      "create_staff_session",
      { p_kind: "area_manager", p_account_id: AM_ID },
      service(),
    );
    expect(mint.status).toBe(200);
    const token = mint.json as string;
    expect(typeof token).toBe("string");

    const revoke = await rpcPost(
      "revoke_staff_session_by_token",
      { p_kind: "area_manager", p_token: token },
      service(),
    );
    expect(revoke.json).toEqual({ verdict: "REVOKED" });

    const again = await rpcPost(
      "revoke_staff_session_by_token",
      { p_kind: "area_manager", p_token: token },
      service(),
    );
    expect(again.json).toEqual({ verdict: "ALREADY_INACTIVE" });
  });

  it("recovery submission over HTTP: true, then duplicate false, then unknown false", async () => {
    const hash = "a".repeat(128);
    const ok = await rpcPost(
      "submit_manager_reset_request",
      { p_staff_id: "budi.santoso", p_candidate_hash: hash },
      service(),
    );
    expect(ok.status).toBe(200);
    expect(ok.json).toBe(true);

    const dup = await rpcPost(
      "submit_manager_reset_request",
      { p_staff_id: "budi.santoso", p_candidate_hash: hash },
      service(),
    );
    expect(dup.json).toBe(false);

    const unknown = await rpcPost(
      "submit_manager_reset_request",
      { p_staff_id: "ghost.user", p_candidate_hash: hash },
      service(),
    );
    expect(unknown.json).toBe(false);
  });

  it("R6-C reservation outcomes over HTTP: verdicts, exactly-once, bucket enforcement", async () => {
    const hashes = { p_client_bucket_hash: "c".repeat(64), p_ip_bucket_hash: "d".repeat(64) };
    const reserve = await rpcPost("reserve_owner_login_attempt", hashes, service());
    expect(reserve.status).toBe(200);
    const reservationId = (reserve.json as Array<{ reservation_id: string }>)[0]?.reservation_id;
    expect(typeof reservationId).toBe("string");

    const done = await rpcPost(
      "complete_owner_login_attempt",
      { p_reservation_id: reservationId, p_success: true },
      service(),
    );
    expect(done.json).toBe("SUCCEEDED");

    const flip = await rpcPost(
      "complete_owner_login_attempt",
      { p_reservation_id: reservationId, p_success: false },
      service(),
    );
    expect(flip.json).toBe("ALREADY_SUCCEEDED");

    // Burn 5 failures: the SAME bucket must block fresh reservations.
    for (let i = 0; i < 5; i++) {
      const r = await rpcPost(
        "reserve_owner_login_attempt",
        { ...hashes, p_attempt_key: `http-attempt-fail-${i}aaaa` },
        service(),
      );
      const id = (r.json as Array<{ reservation_id: string }>)[0]?.reservation_id;
      expect(id).toBeTruthy();
      const c = await rpcPost(
        "complete_owner_login_attempt",
        { p_reservation_id: id, p_success: false },
        service(),
      );
      expect(c.json).toBe("FAILED");
    }
    const blocked = await rpcPost(
      "reserve_owner_login_attempt",
      { ...hashes, p_attempt_key: "http-attempt-fresh-aaaa" },
      service(),
    );
    expect(blocked.json).toBeNull();
  });
});
