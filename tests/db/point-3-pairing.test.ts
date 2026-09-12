// Poin 3 TASKLET: crew pairing lifecycle RPCs (validate code -> request ->
// manager review -> confirm/reject). OTP generation/encryption is SERVER-side:
// the DB only ever sees the sha256 hash and an opaque AES-GCM envelope, and the
// manager listing exposes only the envelope. auth.uid() is simulated with
// request.jwt.claims exactly like PostgREST sets it.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { Client } from "pg";
import { createTestDb, rawHexToken, rpc, sha256Hex, stopAll, type TestDb } from "./harness";

const R1 = "11111111-1111-4111-8111-111111111111";
const R2 = "22222222-2222-4222-8222-222222222222";
const R3 = "33333333-3333-4333-8333-333333333333";
const MANAGER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTP_HASH = "f".repeat(64);
const WRONG_HASH = "0".repeat(64);
const ENVELOPE = "4c494d4551523031" + "ab".repeat(21);

let db: TestDb;
let c: Client;
let managerToken: string;
let r2PendingId = "";
let uidCounter = 0;

function freshUid(): string {
  uidCounter += 1;
  const h = uidCounter.toString(16).padStart(8, "0");
  return `${h}-${h.slice(0, 4)}-4${h.slice(0, 3)}-8${h.slice(0, 3)}-${h}${h.slice(0, 4)}`;
}

async function asUid(uid: string | null): Promise<void> {
  const claims = uid
    ? JSON.stringify({ sub: uid, role: "authenticated" })
    : JSON.stringify({ role: "anon" });
  await c.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
}

async function crewUser(uid: string, email: string): Promise<void> {
  await c.query(`insert into auth.users (id, email) values ($1, $2)`, [uid, email]);
}

async function requestPairing(
  uid: string,
  restaurantId: string,
  name = "Crew Satu",
  otpHash = OTP_HASH,
  envelope = ENVELOPE,
) {
  await asUid(uid);
  return rpc<{ request_id?: string }>(c, "crew_request_pairing", {
    p_restaurant_id: restaurantId,
    p_full_name: name,
    p_otp_hash: otpHash,
    p_otp_encrypted: envelope,
  });
}

async function confirmPairing(uid: string, requestId: string, otpHash = OTP_HASH) {
  await asUid(uid);
  return rpc<{ ok?: boolean; error?: string }>(c, "crew_confirm_pairing", {
    p_request_id: requestId,
    p_otp_hash: otpHash,
  });
}

async function pairingRow(id: string) {
  const r = await c.query(
    `select status, email, restaurant_id, otp_hash, otp_encrypted, attempts,
            expires_at, decided_by, decided_at
       from public.crew_pairing_requests where id = $1`,
    [id],
  );
  return r.rows[0] as Record<string, unknown>;
}

beforeAll(async () => {
  db = await createTestDb("lime_p3_pairing");
  c = await db.client();
  const seed = (id: string, code: string, name: string, active: boolean) =>
    c.query(
      `insert into public.restaurants (id, code, display_name, pin_hash, credential_rotated_at, is_active)
       values ($1, $2, $3, encode(extensions.digest('pin-' || $2, 'sha256'), 'hex'), now(), $4)`,
      [id, code, name, active],
    );
  await seed(R1, "RESTO-1", "Resto Satu", true);
  await seed(R2, "RESTO-2", "Resto Dua", true);
  await seed(R3, "RESTO-OFF", "Resto Off", false);
  await c.query(
    `insert into public.manager_accounts (id, id_manager, full_name, restaurant_id, password_hash, status)
     values ($1, 'p3.manager', 'P3 Manager', $2, 'oldsalt:oldhash', 'aktif')`,
    [MANAGER_ID, R1],
  );
  managerToken = rawHexToken();
  await c.query(
    `insert into public.manager_sessions (manager_id, restaurant_id, token_hash, expires_at)
     values ($1, $2, $3, now() + interval '12 hours')`,
    [MANAGER_ID, R1, sha256Hex(managerToken)],
  );
}, 600_000);

afterAll(async () => {
  await db?.close();
  await stopAll();
});

describe("crew_validate_code", () => {
  test("active code resolves to restaurant identity", async () => {
    await asUid(freshUid());
    const r = await rpc<{ restaurant_id?: string; display_name?: string }>(
      c,
      "crew_validate_code",
      { p_code: " RESTO-1 " },
    );
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({ restaurant_id: R1, display_name: "Resto Satu" });
  });

  test("unknown and inactive codes are INVALID_CODE", async () => {
    await asUid(freshUid());
    expect((await rpc(c, "crew_validate_code", { p_code: "NOPE" })).error).toContain(
      "INVALID_CODE",
    );
    expect((await rpc(c, "crew_validate_code", { p_code: "RESTO-OFF" })).error).toContain(
      "INVALID_CODE",
    );
  });

  test("no authenticated uid is UNAUTHORIZED", async () => {
    await asUid(null);
    expect((await rpc(c, "crew_validate_code", { p_code: "RESTO-1" })).error).toContain(
      "UNAUTHORIZED",
    );
  });
});

describe("crew_request_pairing", () => {
  test("stores pending request with hash + envelope, never plaintext OTP", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-a@example.com");
    const r = await requestPairing(uid, R1);
    expect(r.error).toBeNull();
    const id = r.data!.request_id!;
    const row = await pairingRow(id);
    expect(row).toMatchObject({
      status: "pending",
      email: "crew-a@example.com",
      restaurant_id: R1,
      otp_hash: OTP_HASH,
      otp_encrypted: ENVELOPE,
      attempts: 0,
    });
    expect(JSON.stringify(r.data)).not.toContain("otp");
  });

  test("re-request expires the previous pending row", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-b@example.com");
    const first = (await requestPairing(uid, R1)).data!.request_id!;
    const second = (await requestPairing(uid, R2)).data!.request_id!;
    expect((await pairingRow(first)).status).toBe("expired");
    expect((await pairingRow(second)).status).toBe("pending");
  });

  test("aktif crew is ALREADY_PAIRED, nonaktif may re-request", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-c@example.com");
    await c.query(
      `insert into public.crew_accounts (auth_uid, restaurant_id, email, full_name, status)
       values ($1, $2, 'crew-c@example.com', 'Crew Ceu', 'aktif')`,
      [uid, R1],
    );
    expect((await requestPairing(uid, R1)).error).toContain("ALREADY_PAIRED");
    await c.query(`update public.crew_accounts set status = 'nonaktif' where auth_uid = $1`, [uid]);
    expect((await requestPairing(uid, R1)).error).toBeNull();
  });

  test("bad name and malformed server-supplied hashes are refused", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-d@example.com");
    expect((await requestPairing(uid, R1, "x".repeat(41))).error).toContain("INVALID_NAME");
    expect((await requestPairing(uid, R1, "B\x01ad Name")).error).toContain("INVALID_NAME");
    expect((await requestPairing(uid, R1, "Crew", "zz")).error).toContain("INTERNAL");
    expect((await requestPairing(uid, R1, "Crew", OTP_HASH, "deadbeef")).error).toContain(
      "INTERNAL",
    );
    expect((await requestPairing(uid, "00000000-0000-4000-8000-000000000000")).error).toContain(
      "INVALID_CODE",
    );
    await asUid(null);
    const unauth = await rpc(c, "crew_request_pairing", {
      p_restaurant_id: R1,
      p_full_name: "Crew",
      p_otp_hash: OTP_HASH,
      p_otp_encrypted: ENVELOPE,
    });
    expect(unauth.error).toContain("UNAUTHORIZED");
  });
});

describe("crew_confirm_pairing", () => {
  test("wrong otp persists attempts; 6th call is TOO_MANY_ATTEMPTS", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-e@example.com");
    const id = (await requestPairing(uid, R1)).data!.request_id!;
    for (let i = 1; i <= 5; i += 1) {
      const r = await confirmPairing(uid, id, WRONG_HASH);
      expect(r.data).toEqual({ ok: false, error: "INVALID_OTP" });
      expect((await pairingRow(id)).attempts).toBe(i);
    }
    const r = await confirmPairing(uid, id, OTP_HASH);
    expect(r.data).toEqual({ ok: false, error: "TOO_MANY_ATTEMPTS" });
    expect((await pairingRow(id)).status).toBe("expired");
  });

  test("expired window returns EXPIRED without accepting otp", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-f@example.com");
    const id = (await requestPairing(uid, R1)).data!.request_id!;
    await c.query(
      `update public.crew_pairing_requests set expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    expect(await confirmPairing(uid, id)).toMatchObject({
      data: { ok: false, error: "EXPIRED" },
      error: null,
    });
    expect((await pairingRow(id)).status).toBe("expired");
  });

  test("happy path activates crew account, approves request, audits", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-g@example.com");
    const id = (await requestPairing(uid, R1, "Crew Ge")).data!.request_id!;
    expect(await confirmPairing(uid, id)).toMatchObject({ data: { ok: true }, error: null });
    const row = await pairingRow(id);
    expect(row.status).toBe("approved");
    expect(row.decided_at).not.toBeNull();
    const acc = await c.query(
      `select restaurant_id, email, full_name, status, paired_by from public.crew_accounts where auth_uid = $1`,
      [uid],
    );
    expect(acc.rows[0]).toMatchObject({
      restaurant_id: R1,
      email: "crew-g@example.com",
      full_name: "Crew Ge",
      status: "aktif",
      paired_by: null,
    });
    const audit = await c.query(
      `select 1 from public.admin_audit_log
        where action = 'crew.pairing.approve' and target_id = $1 and restaurant_id = $2`,
      [uid, R1],
    );
    expect(audit.rowCount).toBe(1);
  });

  test("re-pairing after reset upserts the same account row", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-h@example.com");
    const id1 = (await requestPairing(uid, R1, "Crew Hij")).data!.request_id!;
    await confirmPairing(uid, id1);
    await c.query(`update public.crew_accounts set status = 'nonaktif' where auth_uid = $1`, [uid]);
    const id2 = (await requestPairing(uid, R2, "Crew Baru")).data!.request_id!;
    expect(await confirmPairing(uid, id2)).toMatchObject({ data: { ok: true } });
    const acc = await c.query(
      `select restaurant_id, full_name, status from public.crew_accounts where auth_uid = $1`,
      [uid],
    );
    expect(acc.rows[0]).toMatchObject({
      restaurant_id: R2,
      full_name: "Crew Baru",
      status: "aktif",
    });
  });

  test("single-use and foreign requests are rejected", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-i@example.com");
    const id = (await requestPairing(uid, R1)).data!.request_id!;
    expect(await confirmPairing(uid, id)).toMatchObject({ data: { ok: true } });
    expect((await confirmPairing(uid, id)).data).toEqual({ ok: false, error: "NOT_PENDING" });
    const stranger = freshUid();
    await asUid(stranger);
    const foreign = await rpc(c, "crew_confirm_pairing", {
      p_request_id: id,
      p_otp_hash: OTP_HASH,
    });
    expect(foreign.error).toContain("NOT_FOUND");
  });
});

describe("manager-facing pairing RPCs", () => {
  async function listRequests(token: string) {
    return rpc<{ id: string; otp_encrypted?: string; otp_hash?: string }[]>(
      c,
      "get_crew_pairing_requests",
      { p_manager_token: token },
    );
  }

  test("valid token lists own-restaurant pendings with envelope only", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-j@example.com");
    const id = (await requestPairing(uid, R1)).data!.request_id!;
    const other = freshUid();
    await crewUser(other, "crew-k@example.com");
    r2PendingId = (await requestPairing(other, R2)).data!.request_id!;

    const r = await listRequests(managerToken);
    expect(r.error).toBeNull();
    const mine = r.data!.find((row) => row.id === id);
    expect(mine).toMatchObject({ otp_encrypted: ENVELOPE });
    expect(mine!.otp_hash).toBeUndefined();
    expect(r2PendingId).not.toBe("");
    expect(r.data!.map((row) => row.id)).not.toContain(r2PendingId);
  });

  test("lazy-expire hides stale pendings and flips their status", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-l@example.com");
    const id = (await requestPairing(uid, R1)).data!.request_id!;
    await c.query(
      `update public.crew_pairing_requests set expires_at = now() - interval '1 minute' where id = $1`,
      [id],
    );
    const r = await listRequests(managerToken);
    expect(r.data!.map((row) => row.id)).not.toContain(id);
    expect((await pairingRow(id)).status).toBe("expired");
  });

  test("garbage token is INVALID_SESSION", async () => {
    expect((await listRequests("nope".repeat(16))).error).toContain("INVALID_SESSION");
  });

  test("reject flips status, records manager, audits, hides from list", async () => {
    const uid = freshUid();
    await crewUser(uid, "crew-m@example.com");
    const id = (await requestPairing(uid, R1)).data!.request_id!;
    const r = await rpc<{ ok?: boolean; error?: string }>(c, "reject_crew_pairing_request", {
      p_manager_token: managerToken,
      p_request_id: id,
    });
    expect(r.data).toEqual({ ok: true });
    const row = await pairingRow(id);
    expect(row.status).toBe("rejected");
    expect(row.decided_by).toBe(MANAGER_ID);
    expect(row.decided_at).not.toBeNull();
    const audit = await c.query(
      `select 1 from public.admin_audit_log
        where action = 'crew.pairing.reject' and target_id = $1 and actor_id = $2`,
      [uid, MANAGER_ID],
    );
    expect(audit.rowCount).toBe(1);
    expect((await listRequests(managerToken)).data!.map((row) => row.id)).not.toContain(id);
    // single-use + cross-restaurant scope + dead token
    expect(
      (
        await rpc(c, "reject_crew_pairing_request", {
          p_manager_token: managerToken,
          p_request_id: id,
        })
      ).data,
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      (
        await rpc(c, "reject_crew_pairing_request", {
          p_manager_token: managerToken,
          p_request_id: r2PendingId,
        })
      ).data,
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      (
        await rpc(c, "reject_crew_pairing_request", {
          p_manager_token: "nope".repeat(16),
          p_request_id: id,
        })
      ).error,
    ).toContain("INVALID_SESSION");
  });

  test("all five RPCs: authenticated only, never anon/service_role", async () => {
    for (const sig of [
      "crew_validate_code(text)",
      "crew_request_pairing(uuid,text,text,text)",
      "crew_confirm_pairing(uuid,text)",
      "get_crew_pairing_requests(text)",
      "reject_crew_pairing_request(text,uuid)",
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
