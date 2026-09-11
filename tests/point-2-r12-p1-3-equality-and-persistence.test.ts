// P1-3 (R12) failing-first tests: the SERVER equality guard for the mandatory
// old-credential revocation, and pending-handoff persistence failure treated as
// a hard pre-confirm failure with exact cleanup.
//
// The manager bearer is deterministic per (manager, reservation), so a retry of
// the same logical attempt derives the same bearer. Before this blocker, a
// browser whose pending-handoff record was missing or corrupt could surrender
// that freshly minted bearer as its "old" credential: the mandatory revocation
// then self-revoked a confirmed session (permanently burning the bearer through
// the anti-reuse register) or failed closed on UNKNOWN_TOKEN. Revocation
// correctness must not depend on browser storage.
//
// Nothing here loosens fail-closed behaviour: only a byte-equal self-minted
// bearer is skipped, and every other verdict/error path is still asserted.
import { describe, expect, it, vi } from "vitest";
import {
  isSelfMintedManagerBearer,
  loginStaffCore,
  type StaffLoginDeps,
} from "../src/lib/staff-login.server";
import { deriveManagerSessionToken } from "../src/lib/manager-auth.server";
import {
  managerLoginHandoffCore,
  type ManagerHandoffDeps,
  type ManagerHandoffIdentity,
} from "../src/lib/manager-login-handoff";
import type { ManagerIdentity, StorageLike } from "../src/lib/manager-session-identity";
import {
  readPendingManagerHandoff,
  removePendingManagerHandoff,
  writePendingManagerHandoff,
} from "../src/lib/manager-pending-handoff";

type RpcRes = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): RpcRes => ({ data, error: null });
const err = (message: string): RpcRes => ({ data: null, error: { message } });

const GENERIC = "Login gagal. Periksa kembali ID dan password.";
const RESV = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";
const OTHER_RESV = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";
const MANAGER_ID = "m1";

const managerCred = {
  id: MANAGER_ID,
  password_hash: "salt:hash",
  status: "aktif",
  full_name: "M",
  restaurant_id: "r1",
  restaurant_display_name: "Resto",
  restaurant_code: "R1",
};

/** The exact bearer loginStaffCore mints for this manager + reservation. */
const mintedToken = deriveManagerSessionToken(MANAGER_ID, RESV);

type ManagerLoginProbe = {
  deps: StaffLoginDeps;
  revoked: string[];
  reports: boolean[];
  mints: Array<Record<string, unknown>>;
  cleanups: Array<Record<string, unknown>>;
  revokeCalls: Array<{ token: string; opts: unknown }>;
};

function managerLoginDeps(
  overrides: Partial<StaffLoginDeps> = {},
  revokeImpl?: (token: string) => Promise<void>,
): ManagerLoginProbe {
  const revoked: string[] = [];
  const reports: boolean[] = [];
  const mints: Array<Record<string, unknown>> = [];
  const cleanups: Array<Record<string, unknown>> = [];
  const revokeCalls: Array<{ token: string; opts: unknown }> = [];
  const deps: StaffLoginDeps = {
    rpc: async (fn, params) => {
      if (fn === "get_manager_credential") return ok(managerCred);
      if (fn === "create_manager_session_pending") {
        mints.push(params);
        return ok(true);
      }
      if (fn === "cleanup_pending_manager_session") {
        cleanups.push(params);
        return ok(true);
      }
      return err("unexpected rpc");
    },
    verify: async () => true,
    report: async (valid) => {
      reports.push(valid);
      return valid ? "SUCCEEDED" : "FAILED";
    },
    rateLimitReservationId: RESV,
    clearSession: async () => undefined,
    updateSession: async () => undefined,
    cookieStaffTokens: async () => ({ superAdminToken: null, areaManagerToken: null }),
    revokeStaffSessionByToken: async (kind, token) => {
      revoked.push(`${kind}:${token}`);
    },
    revokeManagerSessionByToken: async (token, opts) => {
      revoked.push(`manager:${token}`);
      revokeCalls.push({ token, opts });
      if (revokeImpl) await revokeImpl(token);
    },
    managerExtras: async () => ({ password_changed_at: "set" }),
    ...overrides,
  };
  return { deps, revoked, reports, mints, cleanups, revokeCalls };
}

describe("P1-3: server-side equality guard for mandatory manager revocation", () => {
  it("REPRODUCTION: the bearer this attempt just minted is never revoked", async () => {
    // The browser lost its pending record and surrendered the pending bearer
    // of THIS very attempt. A revoke here would either self-revoke the session
    // it is about to confirm or fail closed on UNKNOWN_TOKEN.
    const probe = managerLoginDeps({ managerTokenToRevoke: mintedToken }, async () => {
      throw new Error("UNKNOWN_TOKEN");
    });
    const result = await loginStaffCore("mgr", "pw", probe.deps);
    expect(result.ok).toBe(true);
    if (!result.ok || result.role !== "manager") throw new Error("expected manager login");
    expect(result.managerToken).toBe(mintedToken);
    expect(result.rateLimitReservationId).toBe(RESV);
    // No revocation attempt at all, no compensation, no accounting decision.
    expect(probe.revoked).toEqual([]);
    expect(probe.revokeCalls).toEqual([]);
    expect(probe.cleanups).toEqual([]);
    expect(probe.reports).toEqual([]);
    // The pending mint still used the exact deterministic pair.
    expect(probe.mints).toEqual([
      { p_manager_id: MANAGER_ID, p_reservation_id: RESV, p_token: mintedToken },
    ]);
  });

  it("a genuinely older bearer is still revoked exactly once, strictly", async () => {
    const oldToken = deriveManagerSessionToken(MANAGER_ID, OTHER_RESV);
    const probe = managerLoginDeps({ managerTokenToRevoke: oldToken });
    const result = await loginStaffCore("mgr", "pw", probe.deps);
    expect(result.ok).toBe(true);
    expect(probe.revoked).toEqual([`manager:${oldToken}`]);
    expect(probe.revokeCalls).toHaveLength(1);
    // Mandatory handoff stays strict: UNKNOWN_TOKEN tolerance is never opted in.
    expect(probe.revokeCalls[0]?.opts).toBeUndefined();
  });

  it("a failed revocation of a genuinely older bearer still fails closed", async () => {
    const oldToken = deriveManagerSessionToken(MANAGER_ID, OTHER_RESV);
    const probe = managerLoginDeps({ managerTokenToRevoke: oldToken }, async () => {
      throw new Error("UNKNOWN_TOKEN");
    });
    const result = await loginStaffCore("mgr", "pw", probe.deps);
    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, message: GENERIC });
    expect(probe.reports).toEqual([false]);
    // The generic failure carries no bearer material.
    expect(JSON.stringify(result)).not.toContain(oldToken);
    expect(JSON.stringify(result)).not.toContain(mintedToken);
  });

  it("the guard skips only the manager bearer: cookie staff bearers are still revoked", async () => {
    const probe = managerLoginDeps({
      managerTokenToRevoke: mintedToken,
      cookieStaffTokens: async () => ({
        superAdminToken: "old-sa",
        areaManagerToken: "old-am",
      }),
    });
    const result = await loginStaffCore("mgr", "pw", probe.deps);
    expect(result.ok).toBe(true);
    expect(probe.revoked).toEqual(["super_admin:old-sa", "area_manager:old-am"]);
  });

  it("a same-manager bearer from ANOTHER reservation is not treated as self-minted", async () => {
    const otherReservationToken = deriveManagerSessionToken(MANAGER_ID, OTHER_RESV);
    expect(otherReservationToken).not.toBe(mintedToken);
    expect(isSelfMintedManagerBearer(otherReservationToken, mintedToken)).toBe(false);
    const probe = managerLoginDeps({ managerTokenToRevoke: otherReservationToken });
    const result = await loginStaffCore("mgr", "pw", probe.deps);
    expect(result.ok).toBe(true);
    expect(probe.revoked).toEqual([`manager:${otherReservationToken}`]);
  });

  it("equality is byte-exact: near-miss, prefix, and case-shifted bearers are revoked", async () => {
    const nearMiss = `${mintedToken.slice(0, -1)}${mintedToken.endsWith("a") ? "b" : "a"}`;
    const prefix = mintedToken.slice(0, 32);
    const upper = mintedToken.toUpperCase();
    for (const candidate of [nearMiss, prefix, upper]) {
      expect(isSelfMintedManagerBearer(candidate, mintedToken), candidate).toBe(false);
      const probe = managerLoginDeps({ managerTokenToRevoke: candidate });
      const result = await loginStaffCore("mgr", "pw", probe.deps);
      expect(result.ok, candidate).toBe(true);
      expect(probe.revoked).toEqual([`manager:${candidate}`]);
    }
    expect(isSelfMintedManagerBearer(mintedToken, mintedToken)).toBe(true);
  });

  it("the guard never treats empty/absent tokens as equal", () => {
    expect(isSelfMintedManagerBearer("", "")).toBe(false);
    expect(isSelfMintedManagerBearer("", mintedToken)).toBe(false);
    expect(isSelfMintedManagerBearer(mintedToken, "")).toBe(false);
  });

  it("no bearer is surrendered at all: nothing is revoked and the login succeeds", async () => {
    const probe = managerLoginDeps({ managerTokenToRevoke: null });
    const result = await loginStaffCore("mgr", "pw", probe.deps);
    expect(result.ok).toBe(true);
    expect(probe.revoked).toEqual([]);
  });
});

// --- pending-handoff persistence failure ----------------------------------

const handoffIdentity: ManagerHandoffIdentity = {
  idManager: "kasir.satu",
  fullName: "Kasir Satu",
  restaurantId: "r1",
  restaurantDisplayName: "Resto",
  restaurantCode: "R1",
  managerToken: mintedToken,
  rateLimitReservationId: RESV,
};

function memoryStorage(): StorageLike {
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
}

function handoffProbe(overrides: Partial<ManagerHandoffDeps> = {}) {
  const order: string[] = [];
  const cleanups: Array<[string, string]> = [];
  const confirmations: Array<[string, string]> = [];
  const written: ManagerIdentity[] = [];
  const storage = memoryStorage();
  const deps: ManagerHandoffDeps = {
    persistPending: (identity) => {
      order.push("persistPending");
      return writePendingManagerHandoff(storage, identity);
    },
    ensureAccessToken: async () => {
      order.push("ensureAccessToken");
      return "anon-tok";
    },
    getStorage: () => storage,
    writeIdentity: (_s, identity) => {
      order.push("writeIdentity");
      written.push(identity);
      return identity;
    },
    setReminderFlag: () => undefined,
    navigate: () => {
      order.push("navigate");
    },
    confirmHandoff: async (token, reservationId) => {
      order.push("confirmHandoff");
      confirmations.push([token, reservationId]);
      return true;
    },
    reconcileHandoff: async () => {
      order.push("reconcileHandoff");
      return "pending";
    },
    cleanupPending: async (token, reservationId) => {
      order.push("cleanupPending");
      cleanups.push([token, reservationId]);
    },
    ...overrides,
  };
  return { deps, order, cleanups, confirmations, written, storage };
}

describe("P1-3: pending-handoff persistence failure is a hard pre-confirm failure", () => {
  it("persists the recovery record FIRST, before any other browser-side work", async () => {
    const probe = handoffProbe();
    const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
    expect(r).toEqual({ ok: true });
    expect(probe.order[0]).toBe("persistPending");
    expect(probe.order).toEqual([
      "persistPending",
      "ensureAccessToken",
      "writeIdentity",
      "navigate",
      "confirmHandoff",
    ]);
    expect(probe.cleanups).toEqual([]);
    // The stored record is the exact recoverable pair.
    expect(readPendingManagerHandoff(probe.storage)).toEqual(handoffIdentity);
  });

  it("a rejected persistence fails closed with the EXACT pending cleanup", async () => {
    const probe = handoffProbe({ persistPending: () => false });
    const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
    expect(r).toEqual({ ok: false, reason: "handoff_failed" });
    expect(probe.cleanups).toEqual([[mintedToken, RESV]]);
    // Nothing else ran: no identity, no navigation, no confirmation.
    expect(probe.order).toEqual(["cleanupPending"]);
    expect(probe.written).toEqual([]);
    expect(probe.confirmations).toEqual([]);
    expect(readPendingManagerHandoff(probe.storage)).toBeNull();
  });

  it("a THROWING persistence (quota/blocked storage) fails closed identically", async () => {
    const probe = handoffProbe({
      persistPending: () => {
        throw new Error("QuotaExceededError");
      },
    });
    const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
    expect(r).toEqual({ ok: false, reason: "handoff_failed" });
    expect(probe.cleanups).toEqual([[mintedToken, RESV]]);
    expect(probe.confirmations).toEqual([]);
  });

  it("absent storage cannot persist, so the handoff never reaches confirm", async () => {
    const probe = handoffProbe({
      persistPending: (identity) => writePendingManagerHandoff(null, identity),
      getStorage: () => null,
    });
    const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
    expect(r).toEqual({ ok: false, reason: "handoff_failed" });
    expect(probe.cleanups).toEqual([[mintedToken, RESV]]);
    expect(probe.confirmations).toEqual([]);
  });

  it("persistence failure + failed cleanup is surfaced as cleanup_failed", async () => {
    const probe = handoffProbe({
      persistPending: () => false,
      cleanupPending: async () => {
        throw new Error("manager handoff cleanup failed");
      },
    });
    const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
    expect(r).toEqual({ ok: false, reason: "cleanup_failed" });
    expect(probe.confirmations).toEqual([]);
    expect(probe.written).toEqual([]);
  });

  it("a non-true (malformed) persistence verdict is not accepted", async () => {
    const persistPending = vi.fn(() => undefined as unknown as boolean);
    const probe = handoffProbe({ persistPending });
    const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
    expect(r).toEqual({ ok: false, reason: "handoff_failed" });
    expect(persistPending).toHaveBeenCalledTimes(1);
    expect(persistPending).toHaveBeenCalledWith(handoffIdentity);
    expect(probe.cleanups).toEqual([[mintedToken, RESV]]);
  });

  it("no failure path leaks the raw bearer into a result value", async () => {
    for (const persistPending of [
      () => false,
      () => {
        throw new Error("blocked");
      },
    ]) {
      const probe = handoffProbe({ persistPending });
      const r = await managerLoginHandoffCore(handoffIdentity, probe.deps);
      expect(JSON.stringify(r)).not.toContain(mintedToken);
    }
  });
});

describe("P1-3: pending-handoff record helpers", () => {
  const KEY = "table-talker.manager-pending-handoff";

  it("round-trips the exact pair under the dedicated key", () => {
    const storage = memoryStorage();
    expect(writePendingManagerHandoff(storage, handoffIdentity)).toBe(true);
    expect(JSON.parse(storage.getItem(KEY) as string)).toEqual(handoffIdentity);
    expect(readPendingManagerHandoff(storage)).toEqual(handoffIdentity);
    removePendingManagerHandoff(storage);
    expect(storage.getItem(KEY)).toBeNull();
    expect(readPendingManagerHandoff(storage)).toBeNull();
  });

  it("a corrupt or incomplete record is dropped, never resumed", () => {
    for (const raw of [
      "not json",
      JSON.stringify({}),
      JSON.stringify({ ...handoffIdentity, managerToken: "" }),
      JSON.stringify({ ...handoffIdentity, rateLimitReservationId: 42 }),
    ]) {
      const storage = memoryStorage();
      storage.setItem(KEY, raw);
      expect(readPendingManagerHandoff(storage), raw).toBeNull();
      expect(storage.getItem(KEY), raw).toBeNull();
    }
  });

  it("null storage and throwing storage never pretend to have persisted", () => {
    expect(writePendingManagerHandoff(null, handoffIdentity)).toBe(false);
    expect(readPendingManagerHandoff(null)).toBeNull();
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(writePendingManagerHandoff(throwing, handoffIdentity)).toBe(false);
    expect(readPendingManagerHandoff(throwing)).toBeNull();
    expect(() => removePendingManagerHandoff(throwing)).not.toThrow();
    expect(() => removePendingManagerHandoff(null)).not.toThrow();
  });
});
