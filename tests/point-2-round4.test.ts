// ROUND 4 failing-first tests (R4-A/B/C). Executable cores with injected
// deps: the manager-login browser handoff, the revoke-by-token contract,
// and the durable rate-limit completion gate. DB-level evidence lives in
// tests/db/staff-access.integration.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeManagerIdentity, type ManagerIdentity } from "../src/lib/manager-session-identity";
import type { StorageLike } from "../src/lib/manager-session-identity";

// --------------------------------------------------------------------------
// R4-A: manager login handoff (browser handoff can never orphan a session)
// --------------------------------------------------------------------------

import { managerLoginHandoffCore, type ManagerHandoffDeps } from "../src/lib/manager-login-handoff";

const handoffIdentity = {
  idManager: "kasir.satgas01",
  fullName: "Kasir Satgas",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  managerToken: "new-mgr-tok",
};

function workingStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

type HandoffOverrides = Partial<ManagerHandoffDeps>;

function handoffDeps(overrides: HandoffOverrides = {}) {
  const calls = {
    navigations: 0,
    confirmations: [] as string[],
    cleanups: [] as string[],
    writtenIdentities: [] as ManagerIdentity[],
  };
  const storage = workingStorage();
  const deps: ManagerHandoffDeps = {
    ensureAccessToken: async () => "anon-access-tok",
    getStorage: () => storage,
    writeIdentity: (s, identity) => {
      const written = writeManagerIdentity(s, identity);
      if (written) calls.writtenIdentities.push(written);
      return written;
    },
    setReminderFlag: () => undefined,
    navigate: () => {
      calls.navigations += 1;
    },
    confirmHandoff: async (managerToken: string) => {
      calls.confirmations.push(managerToken);
      return true;
    },
    cleanupPending: async (managerToken: string) => {
      calls.cleanups.push(managerToken);
    },
    ...overrides,
  };
  return { deps, calls, storage };
}

describe("R4-A: manager login handoff never leaves an active orphan session", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("success path: writes identity, navigates, confirms, no cleanup", async () => {
    const { deps, calls } = handoffDeps();
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r).toEqual({ ok: true });
    expect(calls.navigations).toBe(1);
    expect(calls.confirmations).toEqual(["new-mgr-tok"]);
    expect(calls.cleanups).toEqual([]);
    expect(calls.writtenIdentities).toHaveLength(1);
    expect(calls.writtenIdentities[0]?.accessToken).toBe("anon-access-tok");
  });

  it("anon access token failure cleans up pending session", async () => {
    const { deps, calls } = handoffDeps({ ensureAccessToken: async () => null });
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["new-mgr-tok"]);
    expect(calls.navigations).toBe(0);
    expect(calls.writtenIdentities).toHaveLength(0);
  });

  it("anon access token TRANSPORT failure cleans up pending too (no throw escapes)", async () => {
    const { deps, calls } = handoffDeps({
      ensureAccessToken: async () => {
        throw new Error("network down");
      },
    });
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["new-mgr-tok"]);
    expect(calls.navigations).toBe(0);
  });

  it("storage unavailable cleans up pending session", async () => {
    const { deps, calls } = handoffDeps({ getStorage: () => null });
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["new-mgr-tok"]);
    expect(calls.navigations).toBe(0);
  });

  it("sessionStorage.setItem throwing cleans up pending session", async () => {
    const { deps, calls } = handoffDeps();
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const r = await managerLoginHandoffCore(handoffIdentity, { ...deps, getStorage: () => broken });
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["new-mgr-tok"]);
    expect(calls.navigations).toBe(0);
  });

  it("navigation/handoff failure cleans up pending session", async () => {
    const { deps, calls } = handoffDeps({
      navigate: () => {
        throw new Error("navigation aborted");
      },
    });
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["new-mgr-tok"]);
  });

  it("FAILED confirmation is still fail closed: generic failure, never navigates", async () => {
    const { deps, calls } = handoffDeps({
      confirmHandoff: async () => false,
    });
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false });
    // Navigate happens before confirm; on confirm failure, pending is cleaned up
    expect(calls.navigations).toBe(1);
  });

  it("cleanupPending throwing is swallowed and still fails closed", async () => {
    const { deps, calls } = handoffDeps({
      confirmHandoff: async () => false,
      cleanupPending: async () => {
        throw new Error("rpc down");
      },
    });
    const r = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(r.ok).toBe(false);
    // Cleanup throw is swallowed; navigate already happened before confirm
    expect(calls.navigations).toBe(1);
  });

  it("retry after a failed confirmation yields exactly ONE usable session", async () => {
    let anonFails = true;
    const { deps, calls } = handoffDeps({
      ensureAccessToken: async () => (anonFails ? null : "anon-2"),
    });
    const first = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(first.ok).toBe(false);
    expect(calls.cleanups).toEqual(["new-mgr-tok"]);
    anonFails = false;
    const second = await managerLoginHandoffCore(handoffIdentity, deps);
    expect(second).toEqual({ ok: true });
    expect(calls.writtenIdentities.length).toBeGreaterThanOrEqual(1);
    expect(calls.navigations).toBe(1);
  });
});

// --------------------------------------------------------------------------
// R4-B: revoke-by-token contract is explicit and fail-closed
// --------------------------------------------------------------------------

type RpcRes = { data: unknown; error: { message: string } | null };
let rpcResponse: RpcRes = { data: true, error: null };
let rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = [];

vi.mock("../src/lib/remote-audio.server", () => ({
  getServiceClient: () => ({
    rpc: async (fn: string, params: Record<string, unknown>): Promise<RpcRes> => {
      rpcCalls.push({ fn, params });
      return rpcResponse;
    },
  }),
}));

import { revokeManagerSessionByToken, revokeStaffSessionByToken } from "../src/lib/auth.server";

describe("R4-B: revoke helpers validate the RPC return value", () => {
  afterEach(() => {
    rpcResponse = { data: true, error: null };
    rpcCalls = [];
  });

  it("{data:true,error:null} resolves (session provably revoked)", async () => {
    await expect(revokeManagerSessionByToken("t")).resolves.toBeUndefined();
    await expect(
      revokeStaffSessionByToken("area_manager", "t", { requireRevoked: true }),
    ).resolves.toBeUndefined();
    expect(rpcCalls.map((c) => c.fn)).toEqual([
      "revoke_manager_session_by_token",
      "revoke_staff_session_by_token",
    ]);
  });

  it("{data:false,error:null} = already inactive: OK for idempotent logout/cleanup", async () => {
    rpcResponse = { data: false, error: null };
    await expect(revokeManagerSessionByToken("t")).resolves.toBeUndefined();
    await expect(revokeStaffSessionByToken("super_admin", "t")).resolves.toBeUndefined();
  });

  it("false on a KNOWN-LIVE session (mandatory switch revocation) THROWS fail closed", async () => {
    rpcResponse = { data: false, error: null };
    await expect(revokeManagerSessionByToken("t", { requireRevoked: true })).rejects.toThrow(
      "REVOKE_NOT_REVOKED",
    );
    await expect(
      revokeStaffSessionByToken("super_admin", "t", { requireRevoked: true }),
    ).rejects.toThrow("REVOKE_NOT_REVOKED");
  });

  it("false from a kind/role mismatch never counts as success in mandatory mode", async () => {
    // revoke_manager_session_by_token(p_token=<staff token>) matches nothing -> false
    rpcResponse = { data: false, error: null };
    await expect(
      revokeManagerSessionByToken("staff-kind-token", { requireRevoked: true }),
    ).rejects.toThrow("REVOKE_NOT_REVOKED");
  });

  it("malformed response (null / object / undefined) never counts as success", async () => {
    for (const bad of [null, undefined, { revoked: true }, "true"]) {
      rpcResponse = { data: bad, error: null };
      await expect(revokeManagerSessionByToken("t")).rejects.toThrow("REVOKE_MALFORMED");
      await expect(
        revokeStaffSessionByToken("super_admin", "t", { requireRevoked: true }),
      ).rejects.toThrow();
    }
  });

  it("RPC/transport error throws in BOTH modes (never a silent success)", async () => {
    rpcResponse = { data: null, error: { message: "db down" } };
    await expect(revokeManagerSessionByToken("t")).rejects.toThrow("REVOKE_FAILED");
    await expect(revokeStaffSessionByToken("super_admin", "t")).rejects.toThrow("REVOKE_FAILED");
  });
});

// --------------------------------------------------------------------------
// R4-C: login success requires durable, authoritative rate-limit completion
// --------------------------------------------------------------------------

import { loginStaffCore, type StaffLoginDeps } from "../src/lib/staff-login.server";
import { superAdminLoginCore, type SuperAdminLoginDeps } from "../src/lib/auth";

const managerCred = {
  id: "m1",
  password_hash: "salt:hash",
  status: "aktif",
  full_name: "M",
  restaurant_id: "r1",
  restaurant_display_name: "Resto",
  restaurant_code: "R1",
};

type LoginOverrides = {
  report?: (valid: boolean) => Promise<unknown>;
  revokeManagerSessionByToken?: StaffLoginDeps["revokeManagerSessionByToken"];
  clearSession?: StaffLoginDeps["clearSession"];
  updateSession?: StaffLoginDeps["updateSession"];
};

function managerLoginDeps(overrides: LoginOverrides = {}) {
  const state = { reports: [] as unknown[], revocations: [] as string[], cookieCleared: 0 };
  const deps: StaffLoginDeps = {
    rpc: async (fn) =>
      fn === "get_manager_credential"
        ? { data: managerCred, error: null }
        : fn === "create_manager_session"
          ? { data: "new-mgr-tok", error: null }
          : { data: null, error: { message: "x" } },
    verify: async () => true,
    report: async (v) => {
      state.reports.push(v);
      return true;
    },
    updateSession: async () => undefined,
    clearSession: async () => {
      state.cookieCleared += 1;
    },
    revokeManagerSessionByToken: async (token) => {
      state.revocations.push(`manager:${token}`);
    },
    ...overrides,
  };
  return { deps, state };
}

describe("R4-C: staff login reports success only when completion is authoritative", () => {
  it("manager success: reporter returns true -> ok, EXACTLY ONE report", async () => {
    const { deps, state } = managerLoginDeps();
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(true);
    expect(state.reports).toEqual([true]);
  });

  it("manager: reporter returns FALSE -> fail closed, new session revoked, no usable session", async () => {
    const { deps, state } = managerLoginDeps({
      report: async (v) => {
        state.reports.push(v);
        return false;
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]); // exactly one durable outcome attempt
    expect(state.revocations).toEqual(["manager:new-mgr-tok"]);
    expect(state.cookieCleared).toBeGreaterThanOrEqual(1);
  });

  it("manager: reporter THROWS -> same fail-closed compensation", async () => {
    const { deps, state } = managerLoginDeps({
      report: async (v) => {
        state.reports.push(v);
        throw new Error("limiter down");
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]);
    expect(state.revocations).toEqual(["manager:new-mgr-tok"]);
  });

  it("manager: reporter MALFORMED response (undefined) -> fail closed", async () => {
    const { deps, state } = managerLoginDeps({
      report: async (v) => {
        state.reports.push(v);
        return undefined;
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.revocations).toEqual(["manager:new-mgr-tok"]);
  });

  it("manager: compensation revocation failing STILL returns generic failure (no orphan, no throw)", async () => {
    const { deps } = managerLoginDeps({
      report: async () => false,
      revokeManagerSessionByToken: async () => {
        throw new Error("revoke rpc down");
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
  });

  it("AM success: reporter returns FALSE -> staff session revoked + cookie cleared + failure", async () => {
    const amCred = {
      id: "am-1",
      staff_id: "am.satu",
      password_hash: "salt:hash",
      status: "aktif",
      full_name: "AM",
      password_changed_at: null,
    };
    const state = {
      reports: [] as unknown[],
      staffRevocations: [] as string[],
      cookieCleared: 0,
    };
    const deps: StaffLoginDeps = {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? { data: null, error: { message: "no manager" } }
          : fn === "get_area_manager_credential"
            ? { data: amCred, error: null }
            : fn === "create_staff_session"
              ? { data: "am-tok", error: null }
              : { data: null, error: { message: "x" } },
      verify: async () => true,
      report: async (v) => {
        state.reports.push(v);
        return false;
      },
      updateSession: async () => undefined,
      clearSession: async () => {
        state.cookieCleared += 1;
      },
      revokeStaffSessionByToken: async (kind, token) => {
        state.staffRevocations.push(`${kind}:${token}`);
      },
    };
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]);
    expect(state.staffRevocations).toEqual(["area_manager:am-tok"]);
    expect(state.cookieCleared).toBeGreaterThanOrEqual(1);
  });

  it("AM failure paths keep exactly one false report and never mint a usable pair", async () => {
    const amCred = {
      id: "am-1",
      staff_id: "am.satu",
      password_hash: "salt:hash",
      status: "aktif",
      full_name: "AM",
      password_changed_at: null,
    };
    const deps: StaffLoginDeps = {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? { data: null, error: { message: "no manager" } }
          : fn === "get_area_manager_credential"
            ? { data: amCred, error: null }
            : fn === "create_staff_session"
              ? { data: "am-tok", error: null }
              : { data: null, error: { message: "x" } },
      verify: async () => true,
      report: async (v) => v,
      updateSession: async () => {
        throw new Error("cookie write failed");
      },
      revokeStaffSessionByToken: async () => undefined,
    };
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(false);
  });
});

describe("R4-C: Super Admin login requires authoritative completion", () => {
  function saDeps(
    overrides: {
      report?: SuperAdminLoginDeps["report"];
      clearSession?: SuperAdminLoginDeps["clearSession"];
      revokeStaffSessionByToken?: SuperAdminLoginDeps["revokeStaffSessionByToken"];
    } = {},
  ) {
    const state = {
      reports: [] as unknown[],
      staffRevocations: [] as string[],
      cookieCleared: 0,
    };
    const deps: SuperAdminLoginDeps = {
      rpc: async (fn) =>
        fn === "get_super_admin_credential"
          ? { data: { id: "sa-1", status: "aktif", password_hash: "salt:hash" }, error: null }
          : fn === "create_staff_session"
            ? { data: "sa-tok", error: null }
            : fn === "bootstrap_super_admin_state"
              ? { data: { open: true, active_count: 0 }, error: null }
              : { data: null, error: { message: "x" } },
      verify: async () => true,
      report: async (v) => {
        state.reports.push(v);
        return true;
      },
      updateSession: async () => undefined,
      clearSession: async () => {
        state.cookieCleared += 1;
      },
      revokeStaffSessionByToken: async (kind, token) => {
        state.staffRevocations.push(`${kind}:${token}`);
      },
      legacyPassword: "",
      ...overrides,
    };
    return { deps, state };
  }

  it("individual: reporter returns FALSE -> session revoked + cookie cleared + failure", async () => {
    const { deps, state } = saDeps({
      report: async (v) => {
        state.reports.push(v);
        return false;
      },
    });
    const r = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]);
    expect(state.staffRevocations).toEqual(["super_admin:sa-tok"]);
    expect(state.cookieCleared).toBeGreaterThanOrEqual(1);
  });

  it("individual: reporter THROWS -> same compensation", async () => {
    const { deps, state } = saDeps({
      report: async (v) => {
        state.reports.push(v);
        throw new Error("limiter down");
      },
    });
    const r = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      deps,
    );
    expect(r.ok).toBe(false);
    expect(state.staffRevocations).toEqual(["super_admin:sa-tok"]);
  });

  it("legacy: reporter returns FALSE -> cookie cleared + failure", async () => {
    const { deps, state } = saDeps({
      report: async (v) => {
        state.reports.push(v);
        return false;
      },
    });
    const r = await superAdminLoginCore(
      { mode: "legacy", password: "x" },
      { ...deps, legacyPassword: "x" },
    );
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]);
    expect(state.cookieCleared).toBeGreaterThanOrEqual(1);
  });

  it("success still works when the reporter confirms (true)", async () => {
    const { deps, state } = saDeps();
    const r = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.utama", password: "x" },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(state.reports).toEqual([true]);
    expect(state.staffRevocations).toEqual([]);
  });
});
