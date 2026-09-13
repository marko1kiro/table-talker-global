// Poin 3 TASKLET: crew shift-claim + manager crew-admin RPCs. Same auth.uid()
// simulation (request.jwt.claims) and manager bearer-token pattern as the
// pairing test. Accounts are built through the REAL pairing handshake so the
// display_name / active_device_hash flow exercised here is the one Task 4
// produces. Device binding is a sha256 of an opaque client device token, so
// tests assert on raw role_session_tokens / restaurant_access_tokens rows
// rather than driving a downstream PIN-gated RPC.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, rpcNamed, sha256Hex, stopAll, type TestDb } from "./harness";
import {
  MANAGER_ID,
  R1,
  R2,
  R3,
  asUid as setClaims,
  confirmPairing as hConfirmPairing,
  freshUid,
  crewUser as hCrewUser,
  requestPairing as hRequestPairing,
  seedManager,
  seedManagerSession,
  seedRestaurant,
} from "./point-3-helpers";

const DEVICE_A = "device-A-" + "a".repeat(24);
const DEVICE_B = "device-B-" + "b".repeat(24);

type ClaimResult = {
  session?: { id: string; display_name: string; auth_uid: string; role: string };
  session_token?: string;
  tenant_token?: string;
  restaurant_id?: string;
  restaurant_name?: string;
  restaurant_code?: string;
};

let db: TestDb;
let c: Client;
let managerToken: string;

// Thin call-throughs binding the shared helpers to this suite's client.
const asUid = (uid: string | null) => setClaims(c, uid);
const crewUser = (uid: string, email: string) => hCrewUser(c, uid, email);
const requestPairing = (uid: string, restaurantId: string, name = "Crew Satu") =>
  hRequestPairing(c, uid, restaurantId, name);
const confirmPairing = (uid: string, requestId: string) => hConfirmPairing(c, uid, requestId);

// Pair + confirm a fresh crew account and return its uid (aktif, resto R1).
async function pairedCrew(email: string, name = "Crew One", restaurantId = R1): Promise<string> {
  const uid = freshUid();
  await crewUser(uid, email);
  const id = (await requestPairing(uid, restaurantId, name)).data!.request_id!;
  expect((await confirmPairing(uid, id)).data).toMatchObject({ ok: true });
  return uid;
}

async function claim(
  uid: string | null,
  role: string,
  device: string,
  checkedInAt: string | null = new Date(Date.now() + 60_000).toISOString(),
) {
  await asUid(uid);
  return rpcNamed<ClaimResult>(c, "crew_shift_claim", {
    p_role: role,
    p_checked_in_at: checkedInAt,
    p_device_token: device,
  });
}

function tokenRowFor(token: string) {
  return c.query(
    `select rst.role_session_id, rst.expires_at, rst.code_version, r.code_version as rest_version
       from public.role_session_tokens rst
       join public.restaurants r on r.id = rst.restaurant_id
      where rst.token_hash = $1`,
    [sha256Hex(token)],
  );
}

function tenantRowFor(token: string) {
  return c.query(
    `select restaurant_id, code_version, expires_at
       from public.restaurant_access_tokens where token_hash = $1`,
    [sha256Hex(token)],
  );
}

function liveTokenCount(uid: string) {
  return c.query(
    `select count(*)::int as n
       from public.role_session_tokens rst
       join public.crew_role_sessions crs on crs.id = rst.role_session_id
      where crs.auth_uid = $1`,
    [uid],
  );
}

beforeAll(async () => {
  db = await createTestDb("lime_p3_shift");
  c = await db.client();
  await seedRestaurant(c, R1, "RESTO-1", "Resto Satu");
  await seedRestaurant(c, R2, "RESTO-2", "Resto Dua");
  await seedRestaurant(c, R3, "RESTO-OFF", "Resto Off", false);
  await seedManager(c, MANAGER_ID, R1, "p3s.manager", "P3S Manager");
  managerToken = await seedManagerSession(c, MANAGER_ID, R1);
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

// JWT claims are SESSION-scoped, so every test starts from a clean anon slate
// (asUid(null)) and opts in via asUid(uid).
beforeEach(async () => {
  await asUid(null);
});

describe("crew_shift_claim", () => {
  test("happy path mints role + tenant tokens and a session from the account", async () => {
    const uid = await pairedCrew("shift-happy@example.com", "Shift Happy");
    const r = await claim(uid, "kasir", DEVICE_A);
    expect(r.error).toBeNull();
    const d = r.data!;
    expect(d.session!.display_name).toBe("Shift Happy"); // name from pairing, not an arg
    expect(d.session!.auth_uid).toBe(uid);
    expect(d.session!.role).toBe("kasir");
    expect(d.session_token).toMatch(/^[a-f0-9]{64}$/);
    expect(d.tenant_token).toMatch(/^[a-f0-9]{64}$/);
    expect(d.restaurant_id).toBe(R1);
    expect(d.restaurant_name).toBe("Resto Satu");
    expect(d.restaurant_code).toBe("RESTO-1");

    const tr = (await tokenRowFor(d.session_token!)).rows[0];
    expect(tr.role_session_id).toBe(d.session!.id);
    expect(tr.code_version).toBe(tr.rest_version);
    // 9h role-token expiry (claim_role_session convention)
    const roleHours = (new Date(tr.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(roleHours).toBeGreaterThan(8.5);
    expect(roleHours).toBeLessThanOrEqual(9.1);

    const tenant = (await tenantRowFor(d.tenant_token!)).rows[0];
    expect(tenant.restaurant_id).toBe(R1);
    expect(tenant.code_version).toBe(tr.rest_version);
    // 1h tenant-token expiry, matching the login_to_restaurant_atomic convention
    // (restaurants.server.ts passes now + 60*60*1000).
    const tenantHours = (new Date(tenant.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(tenantHours).toBeGreaterThan(0.9);
    expect(tenantHours).toBeLessThanOrEqual(1.05);
  });

  test("NOT_PAIRED, ACCOUNT_DISABLED and INVALID_* raises", async () => {
    const stranger = freshUid();
    await crewUser(stranger, "shift-stranger@example.com");
    expect((await claim(stranger, "ss", DEVICE_A)).error).toContain("NOT_PAIRED");

    const uid = await pairedCrew("shift-disabled@example.com", "Shift Disabled");
    await c.query(`update public.crew_accounts set status = 'nonaktif' where auth_uid = $1`, [uid]);
    expect((await claim(uid, "ss", DEVICE_A)).error).toContain("ACCOUNT_DISABLED");
    await c.query(`update public.crew_accounts set status = 'aktif' where auth_uid = $1`, [uid]);
    // restaurant deactivated -> ACCOUNT_DISABLED (same generic as dead account)
    await c.query(`update public.crew_accounts set restaurant_id = $2 where auth_uid = $1`, [
      uid,
      R3,
    ]);
    expect((await claim(uid, "ss", DEVICE_A)).error).toContain("ACCOUNT_DISABLED");

    const uid2 = await pairedCrew("shift-role@example.com", "Shift Role");
    expect((await claim(uid2, "chef", DEVICE_A)).error).toContain("INVALID_ROLE");
    expect((await claim(uid2, "ss", "short")).error).toContain("INVALID_DEVICE");
    expect((await claim(uid2, "ss", DEVICE_A, null)).error).toContain("INVALID_CHECKED_IN_AT");

    expect((await claim(null, "ss", DEVICE_A)).error).toContain("UNAUTHORIZED");
  });

  test("device kick: same device keeps prior tokens, new device wipes them", async () => {
    const uid = await pairedCrew("shift-kick@example.com", "Shift Kick");
    const a1 = (await claim(uid, "ss", DEVICE_A)).data!;
    const a2 = (await claim(uid, "ss", DEVICE_A)).data!;
    // same device -> no deletion, both A-issued tokens still alive
    expect((await tokenRowFor(a1.session_token!)).rowCount).toBe(1);
    expect((await tokenRowFor(a2.session_token!)).rowCount).toBe(1);
    expect((await liveTokenCount(uid)).rows[0].n).toBe(2);

    const b = (await claim(uid, "ss", DEVICE_B)).data!;
    // device B issued -> A's two tokens gone, only B's live token remains
    expect((await tokenRowFor(a1.session_token!)).rowCount).toBe(0);
    expect((await tokenRowFor(a2.session_token!)).rowCount).toBe(0);
    expect((await tokenRowFor(b.session_token!)).rowCount).toBe(1);
    expect((await liveTokenCount(uid)).rows[0].n).toBe(1);
  });
});

describe("crew_me", () => {
  test("unpaired, paired, and device_current reflect account state", async () => {
    const uid = await pairedCrew("shift-me@example.com", "Shift Me");
    await asUid(uid);
    const before = await rpcNamed<Record<string, unknown>>(c, "crew_me", {
      p_device_token: DEVICE_A,
    });
    expect(before.error).toBeNull();
    expect(before.data).toMatchObject({ paired: true, status: "aktif", full_name: "Shift Me" });
    expect(before.data!.device_current).toBe(false); // hash is null, not equal

    await claim(uid, "ss", DEVICE_A);
    await asUid(uid);
    const afterA = await rpcNamed<Record<string, unknown>>(c, "crew_me", {
      p_device_token: DEVICE_A,
    });
    expect(afterA.data).toMatchObject({ paired: true, device_current: true });
    const afterB = await rpcNamed<Record<string, unknown>>(c, "crew_me", {
      p_device_token: DEVICE_B,
    });
    expect(afterB.data).toMatchObject({ paired: true, device_current: false });

    const stranger = freshUid();
    await crewUser(stranger, "shift-me-none@example.com");
    await asUid(stranger);
    const none = await rpcNamed<Record<string, unknown>>(c, "crew_me", {
      p_device_token: DEVICE_A,
    });
    expect(none.data).toEqual({ paired: false });

    await asUid(null);
    expect((await rpcNamed(c, "crew_me", { p_device_token: DEVICE_A })).error).toContain(
      "UNAUTHORIZED",
    );
  });
});

describe("get_crew_accounts", () => {
  test("lists own restaurant with has_active_device and active_sessions count", async () => {
    const uidA = await pairedCrew("shift-list-a@example.com", "List A");
    await claim(uidA, "kasir", DEVICE_A); // 1 live token
    await claim(uidA, "ss", DEVICE_A); // 2 live tokens (same device, no kick)
    const uidOff = await pairedCrew("shift-list-off@example.com", "List Off", R2); // other resto
    const uidIdle = await pairedCrew("shift-list-idle@example.com", "List Idle"); // paired, never claimed
    const r = await rpcNamed<Record<string, unknown>[]>(c, "get_crew_accounts", {
      p_manager_token: managerToken,
    });
    expect(r.error).toBeNull();
    const ids = r.data!.map((row) => row.auth_uid);
    expect(ids).toContain(uidA);
    expect(ids).not.toContain(uidOff);
    const a = r.data!.find((row) => row.auth_uid === uidA)!;
    expect(a).toMatchObject({ full_name: "List A", status: "aktif", has_active_device: true });
    expect(a.active_sessions).toBe(2);
    const idle = r.data!.find((row) => row.auth_uid === uidIdle)!;
    expect(idle).toMatchObject({ full_name: "List Idle", has_active_device: false });
    expect(idle.active_sessions).toBe(0);
    const off = r.data!.find((row) => row.auth_uid === uidOff);
    expect(off).toBeUndefined();

    expect(
      (await rpcNamed(c, "get_crew_accounts", { p_manager_token: "nope".repeat(16) })).error,
    ).toContain("INVALID_SESSION");
  });
});

describe("reset_crew_account / end_active_crew_sessions", () => {
  test("reset disables account, wipes device + tokens, audits, allows re-pair", async () => {
    const uid = await pairedCrew("shift-reset@example.com", "Shift Reset");
    await claim(uid, "ss", DEVICE_A);
    const r = await rpcNamed<{ ok?: boolean; error?: string }>(c, "reset_crew_account", {
      p_manager_token: managerToken,
      p_auth_uid: uid,
    });
    expect(r.data).toEqual({ ok: true });
    const acc = await c.query(
      `select status, active_device_hash from public.crew_accounts where auth_uid = $1`,
      [uid],
    );
    expect(acc.rows[0]).toMatchObject({ status: "nonaktif", active_device_hash: null });
    expect((await liveTokenCount(uid)).rows[0].n).toBe(0);
    const audit = await c.query(
      `select 1 from public.admin_audit_log
        where action = 'crew.account.reset' and target_id = $1 and actor_id = $2`,
      [uid, MANAGER_ID],
    );
    expect(audit.rowCount).toBe(1);
    // claim is blocked while nonaktif
    expect((await claim(uid, "ss", DEVICE_A)).error).toContain("ACCOUNT_DISABLED");
    // re-request pairing works (Task 4 interop: only aktif is ALREADY_PAIRED)
    const id = (await requestPairing(uid, R1, "Shift Reset")).data!.request_id!;
    expect((await confirmPairing(uid, id)).data).toMatchObject({ ok: true });
  });

  test("end sessions clears tokens only, account stays aktif and claimable", async () => {
    const uid = await pairedCrew("shift-end@example.com", "Shift End");
    await claim(uid, "ss", DEVICE_A);
    const r = await rpcNamed<{ ok?: boolean }>(c, "end_active_crew_sessions", {
      p_manager_token: managerToken,
      p_auth_uid: uid,
    });
    expect(r.data).toEqual({ ok: true });
    expect((await liveTokenCount(uid)).rows[0].n).toBe(0);
    const acc = await c.query(`select status from public.crew_accounts where auth_uid = $1`, [uid]);
    expect(acc.rows[0].status).toBe("aktif");
    const audit = await c.query(
      `select 1 from public.admin_audit_log
        where action = 'crew.sessions.end' and target_id = $1`,
      [uid],
    );
    expect(audit.rowCount).toBe(1);
    // further claims unaffected
    expect((await claim(uid, "ss", DEVICE_A)).error).toBeNull();
  });

  test("cross-restaurant / unknown uid collapses to NOT_FOUND", async () => {
    const uidOff = await pairedCrew("shift-scope@example.com", "Shift Scope", R2);
    expect(
      (
        await rpcNamed<{ ok?: boolean; error?: string }>(c, "reset_crew_account", {
          p_manager_token: managerToken,
          p_auth_uid: uidOff,
        })
      ).data,
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      (
        await rpcNamed<{ ok?: boolean; error?: string }>(c, "end_active_crew_sessions", {
          p_manager_token: managerToken,
          p_auth_uid: "99999999-9999-4999-8999-999999999999",
        })
      ).data,
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      (
        await rpcNamed(c, "reset_crew_account", {
          p_manager_token: "nope".repeat(16),
          p_auth_uid: uidOff,
        })
      ).error,
    ).toContain("INVALID_SESSION");
  });
});

describe("grant hygiene", () => {
  test("all five RPCs: authenticated only, never anon/service_role", async () => {
    for (const sig of [
      "crew_shift_claim(text,timestamptz,text)",
      "crew_me(text)",
      "get_crew_accounts(text)",
      "reset_crew_account(text,uuid)",
      "end_active_crew_sessions(text,uuid)",
    ]) {
      const r = await c.query(
        `select has_function_privilege('authenticated', 'public.' || $1, 'execute') as authed,
                has_function_privilege('anon', 'public.' || $1, 'execute') as an,
                has_function_privilege('service_role', 'public.' || $1, 'execute') as svc`,
        [sig],
      );
      expect(r.rows[0]).toEqual({ authed: true, an: false, svc: false });
    }
  });
});
