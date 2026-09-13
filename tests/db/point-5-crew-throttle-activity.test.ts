// Poin 5 (G4 + G2) DB suite: pairing-request throttle (5/uid/rolling-hour) and
// the manager-facing crew activity feed (get_crew_activity over admin_audit_log).
// Reuses the Poin 3 shared helpers unchanged; per-uid freshness isolates the
// throttle counter across tests, and every audit-producing event in THIS file
// targets R1 so the R2 scope assertion below can stay a clean "sees nothing".
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, rpcNamed, stopAll, type TestDb } from "./harness";
import {
  MANAGER_ID,
  R1,
  R2,
  asUid as setClaims,
  confirmPairing as hConfirmPairing,
  crewUser as hCrewUser,
  freshUid,
  requestPairing as hRequestPairing,
  seedManager,
  seedManagerSession,
  seedRestaurant,
} from "./point-3-helpers";

let db: TestDb;
let c: Client;
let tokenR1: string;
let tokenR2: string;
const MANAGER_ID_R2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

const asUid = (uid: string | null) => setClaims(c, uid);
const crewUser = (uid: string, email: string) => hCrewUser(c, uid, email);
const requestPairing = (uid: string, restaurantId: string, name?: string) =>
  hRequestPairing(c, uid, restaurantId, name);
const confirmPairing = (uid: string, requestId: string) => hConfirmPairing(c, uid, requestId);

beforeAll(async () => {
  db = await createTestDb("lime_p5_throttle_activity");
  c = await db.client();
  await seedRestaurant(c, R1, "RESTO-1", "Resto Satu");
  await seedRestaurant(c, R2, "RESTO-2", "Resto Dua");
  await seedManager(c, MANAGER_ID, R1, "p5.manager", "P5 Manager");
  await seedManager(c, MANAGER_ID_R2, R2, "p5.manager2", "P5 Manager Dua");
  tokenR1 = await seedManagerSession(c, MANAGER_ID, R1);
  tokenR2 = await seedManagerSession(c, MANAGER_ID_R2, R2);
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

beforeEach(async () => {
  await asUid(null);
});

async function activity(token: string) {
  const r = await rpcNamed<
    Array<{ created_at: string; action: string; actor_label: string | null; crew_name: string }>
  >(c, "get_crew_activity", { p_manager_token: token });
  expect(r.error).toBeNull();
  return r.data ?? [];
}

describe("crew_request_pairing throttle (G4)", () => {
  test("5 requests per uid fit; the 6th is PAIRING_THROTTLED and the live pending survives", async () => {
    const uid = freshUid();
    await crewUser(uid, "throttle1@p5.test");
    for (let i = 0; i < 5; i++) {
      const r = await requestPairing(uid, R1);
      expect(r.error).toBeNull();
      expect(r.data).toMatchObject({ ok: true });
    }
    const sixth = await requestPairing(uid, R1);
    expect(sixth.data).toEqual({ ok: false, error: "PAIRING_THROTTLED" });

    const rows = await c.query(
      `select count(*)::int as n,
              count(*) filter (where status = 'pending')::int as pending
         from public.crew_pairing_requests
        where auth_uid = $1 and created_at > now() - interval '60 minutes'`,
      [uid],
    );
    expect(rows.rows[0].n).toBe(5); // the throttled call inserted nothing
    expect(rows.rows[0].pending).toBe(1); // newest-wins pending NOT expired by the refusal
  });

  test("throttle is per uid — a different account is unaffected", async () => {
    const a = freshUid();
    const b = freshUid();
    await crewUser(a, "throttle-a@p5.test");
    await crewUser(b, "throttle-b@p5.test");
    for (let i = 0; i < 5; i++)
      expect((await requestPairing(a, R1)).data).toMatchObject({ ok: true });
    expect((await requestPairing(a, R1)).data).toMatchObject({ error: "PAIRING_THROTTLED" });
    expect((await requestPairing(b, R1)).data).toMatchObject({ ok: true });
  });
});

describe("get_crew_activity (G2)", () => {
  test("approve, sessions-end and reset each surface newest-first with crew name; reject names the actor", async () => {
    const uid = freshUid();
    await crewUser(uid, "feed@p5.test");
    const req = await requestPairing(uid, R1, "Feed Crew");
    const requestId = String((req.data as { request_id?: string }).request_id);
    expect((await confirmPairing(uid, requestId)).data).toMatchObject({ ok: true });

    const rejected = freshUid();
    await crewUser(rejected, "rejected@p5.test");
    const req2 = await requestPairing(rejected, R1, "Reject Crew");
    const rid2 = String((req2.data as { request_id?: string }).request_id);
    const rej = await rpcNamed(c, "reject_crew_pairing_request", {
      p_manager_token: tokenR1,
      p_request_id: rid2,
    });
    expect(rej.error).toBeNull();

    await asUid(null);
    expect(
      (await rpcNamed(c, "end_active_crew_sessions", { p_manager_token: tokenR1, p_auth_uid: uid }))
        .error,
    ).toBeNull();
    expect(
      (await rpcNamed(c, "reset_crew_account", { p_manager_token: tokenR1, p_auth_uid: uid }))
        .error,
    ).toBeNull();

    const list = await activity(tokenR1);
    const by = (action: string) => list.filter((a) => a.action === action);
    const approve = by("crew.pairing.approve").find((a) => a.crew_name === "Feed Crew");
    const reject = by("crew.pairing.reject").find((a) => a.crew_name === "Reject Crew");
    const end = by("crew.sessions.end").find((a) => a.crew_name === "Feed Crew");
    const reset = by("crew.account.reset").find((a) => a.crew_name === "Feed Crew");
    expect(approve).toBeTruthy();
    expect(approve?.actor_label).toBeNull(); // self-service approval is audited as system
    expect(reject?.actor_label).toBe("p5.manager");
    expect(end?.actor_label).toBe("p5.manager");
    expect(reset?.actor_label).toBe("p5.manager");

    const idx = (a: { created_at: string; action: string }) =>
      list.findIndex((x) => x.created_at === a.created_at && x.action === a.action);
    expect(idx(reset!)).toBeLessThan(idx(end!)); // newest first
    expect(idx(end!)).toBeLessThan(idx(approve!));
  });

  test("restaurant scoping: the R2 manager sees nothing from R1's lifecycle", async () => {
    const list = await activity(tokenR2);
    expect(list).toEqual([]);
  });

  test("dead token is INVALID_SESSION", async () => {
    const r = await rpcNamed(c, "get_crew_activity", { p_manager_token: "no-such-token" });
    expect(r.error).toContain("INVALID_SESSION");
  });
});
