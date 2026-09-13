// Poin 3 Task 7: ensureStaffCarrier pure-core tests (injected deps, repo
// convention). The carrier is a rotating shadow password: create-once,
// rotate-every-call, validated against the SAME staff session the dashboards
// verify with (manager: get_manager_id_by_token + pending-handoff fallback;
// area_manager: get_staff_session).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCarrierDeps,
  carrierEmailFor,
  ensureStaffCarrierCore,
  ensureStaffCarrierInputSchema,
  type StaffCarrierDeps,
  type StaffKind,
} from "../src/lib/staff-carrier.server";

const source = () =>
  readFileSync(new URL("../src/lib/staff-carrier.server.ts", import.meta.url), "utf8");

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_TOKEN = "t".repeat(64);
const HEX64 = /^[a-f0-9]{64}$/;

function makeDeps(overrides: Partial<StaffCarrierDeps> = {}): {
  deps: StaffCarrierDeps;
  calls: {
    verify: Array<[StaffKind, string]>;
    read: Array<[StaffKind, string]>;
    store: Array<[StaffKind, string, string]>;
    create: Array<{ email: string; password: string; appMetadata: unknown }>;
    rotate: Array<[string, string]>;
  };
} {
  let nonce = 0;
  const calls: {
    verify: Array<[StaffKind, string]>;
    read: Array<[StaffKind, string]>;
    store: Array<[StaffKind, string, string]>;
    create: Array<{ email: string; password: string; appMetadata: unknown }>;
    rotate: Array<[string, string]>;
  } = { verify: [], read: [], store: [], create: [], rotate: [] };
  const deps: StaffCarrierDeps = {
    verifySession: async (kind, token) => {
      calls.verify.push([kind, token]);
      return ACCOUNT_ID;
    },
    readAccount: async (kind, accountId) => {
      calls.read.push([kind, accountId]);
      return { status: "aktif", auth_user_id: null };
    },
    storeAuthUserId: async (kind, accountId, authUserId) => {
      calls.store.push([kind, accountId, authUserId]);
    },
    createCarrierUser: async (input) => {
      calls.create.push(input);
      return "auth-user-new";
    },
    setCarrierPassword: async (authUserId, password) => {
      calls.rotate.push([authUserId, password]);
      return true;
    },
    newHex64: () => (++nonce).toString(16).padStart(64, "0"),
    ...overrides,
  };
  return { deps, calls };
}

const input = (staffKind: "manager" | "area_manager" = "manager") => ({
  staffKind,
  sessionToken: SESSION_TOKEN,
});

describe("ensureStaffCarrierCore", () => {
  it("creates the shadow user once when auth_user_id is null, then rotates to a FRESH password", async () => {
    const { deps, calls } = makeDeps();
    const result = await ensureStaffCarrierCore(input(), deps);
    expect(result).toMatchObject({
      ok: true,
      carrierEmail: `shadow+m-${ACCOUNT_ID}@lihatmeja.com`,
    });
    const create = calls.create[0];
    expect(calls.create).toHaveLength(1);
    expect(create.email).toBe(`shadow+m-${ACCOUNT_ID}@lihatmeja.com`);
    expect(create.password).toMatch(HEX64);
    expect(create.appMetadata).toEqual({ kind: "manager", account_id: ACCOUNT_ID });
    expect(calls.store).toEqual([["manager", ACCOUNT_ID, "auth-user-new"]]);
    expect(calls.rotate).toHaveLength(1);
    const [rotatedId, rotatedPw] = calls.rotate[0];
    expect(rotatedId).toBe("auth-user-new");
    expect(rotatedPw).toMatch(HEX64);
    expect(rotatedPw).not.toBe(create.password);
    expect(result).toMatchObject({ carrierPassword: rotatedPw });
  });

  it("rotates EVERY call for an existing carrier without a second createUser", async () => {
    const { deps, calls } = makeDeps({
      readAccount: async () => ({ status: "aktif", auth_user_id: "auth-existing" }),
    });
    const first = await ensureStaffCarrierCore(input(), deps);
    const second = await ensureStaffCarrierCore(input(), deps);
    expect(calls.create).toHaveLength(0);
    expect(calls.store).toHaveLength(0);
    expect(calls.rotate).toHaveLength(2);
    expect(calls.rotate.every(([id]) => id === "auth-existing")).toBe(true);
    const pw1 = (first as { carrierPassword: string }).carrierPassword;
    const pw2 = (second as { carrierPassword: string }).carrierPassword;
    expect(pw1).toMatch(HEX64);
    expect(pw2).toMatch(HEX64);
    expect(pw1).not.toBe(pw2);
    expect(first).toMatchObject({ carrierEmail: `shadow+m-${ACCOUNT_ID}@lihatmeja.com` });
  });

  it("area_manager carrier email uses the am prefix and the kind propagates to verification", async () => {
    const { deps, calls } = makeDeps();
    const result = await ensureStaffCarrierCore(input("area_manager"), deps);
    expect(result).toMatchObject({ ok: true });
    expect(calls.verify[0]?.[0]).toBe("area_manager");
    expect(carrierEmailFor("area_manager", "22222222-2222-4222-8222-222222222222")).toBe(
      "shadow+am-22222222-2222-4222-8222-222222222222@lihatmeja.com",
    );
  });

  it("unverifiable session (wrong/expired/revoked) -> INVALID_SESSION with zero admin calls", async () => {
    const { deps, calls } = makeDeps({ verifySession: async () => null });
    const result = await ensureStaffCarrierCore(input(), deps);
    expect(result).toEqual({
      ok: false,
      code: "INVALID_SESSION",
      message: expect.any(String),
    });
    expect(calls.create).toHaveLength(0);
    expect(calls.rotate).toHaveLength(0);
  });

  it("unknown or non-aktif account -> INVALID_SESSION, never leaking which part failed", async () => {
    for (const account of [null, { status: "nonaktif", auth_user_id: "auth-x" }]) {
      const { deps } = makeDeps({ readAccount: async () => account });
      const bad = await ensureStaffCarrierCore(input(), deps);
      const missing = await ensureStaffCarrierCore(input("area_manager"), deps);
      expect(bad).toEqual(missing);
      expect(bad).toMatchObject({ ok: false, code: "INVALID_SESSION" });
    }
  });

  it("GoTrue admin failures map to generic UNAVAILABLE", async () => {
    const noUser = makeDeps({ createCarrierUser: async () => null });
    expect(await ensureStaffCarrierCore(input(), noUser.deps)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    const noRotate = makeDeps({ setCarrierPassword: async () => false });
    expect(await ensureStaffCarrierCore(input(), noRotate.deps)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("thrown dependency errors degrade to UNAVAILABLE without leaking secrets", async () => {
    const { deps } = makeDeps({
      verifySession: async () => {
        throw new Error(`transport blew up on ${SESSION_TOKEN}`);
      },
    });
    const result = await ensureStaffCarrierCore(input(), deps);
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain(SESSION_TOKEN);
  });

  it("zod validator pins staffKind to the two staff kinds and bounds the bearer", () => {
    expect(ensureStaffCarrierInputSchema.safeParse(input()).success).toBe(true);
    expect(
      ensureStaffCarrierInputSchema.safeParse({ staffKind: "crew", sessionToken: SESSION_TOKEN })
        .success,
    ).toBe(false);
    expect(
      ensureStaffCarrierInputSchema.safeParse({ staffKind: "manager", sessionToken: "short" })
        .success,
    ).toBe(false);
  });

  it("never logs and never calls the banned anonymous flow", () => {
    const text = source();
    expect(text).not.toContain("console.log");
    expect(text).not.toContain("signInAnonymously");
  });
});

// ---------------------------------------------------------------------------
// buildCarrierDeps against a fake service client (wiring of the REAL
// verification RPCs, the account tables, and the GoTrue admin API).
// ---------------------------------------------------------------------------

type Builder = {
  select: (cols: string) => Builder;
  update: (payload: Record<string, unknown>) => Builder;
  eq: (col: string, val: unknown) => Builder;
  gt: (col: string, val: unknown) => Builder;
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
  then: (
    onFulfilled: (v: { data: null; error: null }) => unknown,
    onRejected?: (r: unknown) => unknown,
  ) => Promise<unknown>;
};

function fakeClient(options: {
  rpcResults?: Record<string, { data: unknown; error: { message: string } | null }>;
  rows?: Record<string, unknown>;
  userResult?: { data: { user: { id: string } | null } | null; error: unknown };
}) {
  const seen = {
    rpcs: [] as Array<{ fn: string; params: Record<string, unknown> }>,
    queries: [] as Array<{
      table: string;
      eqs: Array<[string, unknown]>;
      gts: Array<[string, unknown]>;
    }>,
    updates: [] as Array<{ table: string; payload: Record<string, unknown>; id: unknown }>,
    createUser: [] as Array<Record<string, unknown>>,
    updateUserById: [] as Array<[string, Record<string, unknown>]>,
  };
  const makeBuilder = (table: string, updatePayload?: Record<string, unknown>): Builder => {
    const query = {
      table,
      eqs: [] as Array<[string, unknown]>,
      gts: [] as Array<[string, unknown]>,
    };
    seen.queries.push(query);
    const builder: Builder = {
      select: () => builder,
      update: (payload) => makeBuilder(table, payload),
      eq: (col, val) => {
        if (updatePayload && col === "id") {
          seen.updates.push({ table, payload: updatePayload, id: val });
        } else {
          query.eqs.push([col, val]);
        }
        return builder;
      },
      gt: (col, val) => {
        query.gts.push([col, val]);
        return builder;
      },
      maybeSingle: async () => ({ data: options.rows?.[table] ?? null, error: null }),
      then: (onFulfilled, onRejected) =>
        Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected),
    };
    return builder;
  };
  const client = {
    rpc: async (fn: string, params: Record<string, unknown>) => {
      seen.rpcs.push({ fn, params });
      return options.rpcResults?.[fn] ?? { data: null, error: null };
    },
    from: (table: string) => makeBuilder(table),
    auth: {
      admin: {
        createUser: async (input: Record<string, unknown>) => {
          seen.createUser.push(input);
          return options.userResult ?? { data: { user: { id: "auth-user-new" } }, error: null };
        },
        updateUserById: async (id: string, input: Record<string, unknown>) => {
          seen.updateUserById.push([id, input]);
          return { error: null };
        },
      },
    },
  };
  // The handler only needs these; expose the seen log for assertions.
  return { client: client as never, seen };
}

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

describe("buildCarrierDeps (service-role wiring)", () => {
  it("manager: verifies via get_manager_id_by_token, reads manager_accounts, creates with email_confirm, stores via update, rotates via updateUserById", async () => {
    const { client, seen } = fakeClient({
      rpcResults: { get_manager_id_by_token: { data: ACCOUNT_ID, error: null } },
      rows: { manager_accounts: { status: "aktif", auth_user_id: null } },
    });
    const deps = buildCarrierDeps(client);
    const result = await ensureStaffCarrierCore(input(), deps);
    expect(result).toMatchObject({ ok: true });
    expect(seen.rpcs[0]).toEqual({
      fn: "get_manager_id_by_token",
      params: { p_token: SESSION_TOKEN },
    });
    expect(seen.queries.some((q) => q.table === "manager_accounts")).toBe(true);
    expect(seen.createUser[0]).toMatchObject({
      email: `shadow+m-${ACCOUNT_ID}@lihatmeja.com`,
      email_confirm: true,
      app_metadata: { kind: "manager", account_id: ACCOUNT_ID },
    });
    expect(seen.createUser[0]!.password).toMatch(HEX64);
    expect(seen.updates).toEqual([
      { table: "manager_accounts", payload: { auth_user_id: "auth-user-new" }, id: ACCOUNT_ID },
    ]);
    expect(seen.updateUserById).toHaveLength(1);
    expect(seen.updateUserById[0]![0]).toBe("auth-user-new");
    expect(seen.updateUserById[0]![1].password).toMatch(HEX64);
  });

  it("manager pre-confirm bearer: falls back to the pending-handoff row via sha256(token) + expiry", async () => {
    const { client, seen } = fakeClient({
      rpcResults: { get_manager_id_by_token: { data: null, error: null } },
      rows: {
        manager_pending_sessions: { manager_id: ACCOUNT_ID },
        manager_accounts: { status: "aktif", auth_user_id: "auth-existing" },
      },
    });
    const deps = buildCarrierDeps(client);
    const result = await ensureStaffCarrierCore(input(), deps);
    expect(result).toMatchObject({ ok: true });
    const pending = seen.queries.find((q) => q.table === "manager_pending_sessions");
    expect(pending).toBeTruthy();
    expect(pending!.eqs[0]).toEqual(["token_hash", sha256Hex(SESSION_TOKEN)]);
    expect(pending!.gts[0]?.[0]).toBe("expires_at");
  });

  it("pending row gone too -> INVALID_SESSION and zero admin calls", async () => {
    const { client, seen } = fakeClient({
      rpcResults: { get_manager_id_by_token: { data: null, error: null } },
    });
    const deps = buildCarrierDeps(client);
    const result = await ensureStaffCarrierCore(input(), deps);
    expect(result).toMatchObject({ ok: false, code: "INVALID_SESSION" });
    expect(seen.createUser).toHaveLength(0);
    expect(seen.updateUserById).toHaveLength(0);
  });

  it("area_manager: verifies via get_staff_session with p_kind and reads area_manager_accounts", async () => {
    const { client, seen } = fakeClient({
      rpcResults: { get_staff_session: { data: ACCOUNT_ID, error: null } },
      rows: { area_manager_accounts: { status: "aktif", auth_user_id: "auth-existing" } },
    });
    const deps = buildCarrierDeps(client);
    const result = await ensureStaffCarrierCore(input("area_manager"), deps);
    expect(result).toMatchObject({ ok: true });
    expect(seen.rpcs[0]).toEqual({
      fn: "get_staff_session",
      params: { p_kind: "area_manager", p_token: SESSION_TOKEN },
    });
    expect(seen.queries.some((q) => q.table === "area_manager_accounts")).toBe(true);
  });
});
