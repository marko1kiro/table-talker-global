// ROUND 5 R5-A: pending→active handshake for manager login handoff.
// Every pre-confirmation failure MUST leave zero active sessions.
// The browser never sees an active usable session until confirmHandoff
// succeeds after identity write.
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeManagerIdentity, type ManagerIdentity } from "../src/lib/manager-session-identity";
import type { StorageLike } from "../src/lib/manager-session-identity";

import { managerLoginHandoffCore, type ManagerHandoffDeps } from "../src/lib/manager-login-handoff";

const identity = {
  idManager: "kasir.satgas01",
  fullName: "Kasir Satgas",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  managerToken: "pending-mgr-tok",
  // R6-C: the reservation finalized by confirm/cleanup (stand-in uuid here —
  // this suite tests the handoff orchestration, not the limiter).
  rateLimitReservationId: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
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
    writeIdentity: (s, id) => {
      const written = writeManagerIdentity(s, id);
      if (written) calls.writtenIdentities.push(written);
      return written;
    },
    setReminderFlag: () => undefined,
    navigate: () => {
      calls.navigations += 1;
    },
    confirmHandoff: async (token: string) => {
      calls.confirmations.push(token);
      return true;
    },
    cleanupPending: async (token: string) => {
      calls.cleanups.push(token);
    },
    ...overrides,
  };
  return { deps, calls, storage };
}

describe("R5-A: pending→active handshake never leaves active orphan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("success: confirms AFTER identity write + navigate, no cleanup, no revoke", async () => {
    const { deps, calls } = handoffDeps();
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r).toEqual({ ok: true });
    expect(calls.navigations).toBe(1);
    expect(calls.confirmations).toEqual(["pending-mgr-tok"]);
    expect(calls.cleanups).toEqual([]);
    expect(calls.writtenIdentities).toHaveLength(1);
    expect(calls.writtenIdentities[0]?.accessToken).toBe("anon-access-tok");
  });

  // --- Pre-confirmation failures: pending session must be cleaned up ---

  it("confirmHandoff fails: cleanup pending, navigate already happened, generic failure", async () => {
    const { deps, calls } = handoffDeps({
      confirmHandoff: async (tok) => {
        calls.confirmations.push(tok);
        return false;
      },
    });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ ok: false, reason: "handoff_failed" });
    expect(calls.navigations).toBe(1);
    expect(calls.confirmations).toEqual(["pending-mgr-tok"]);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
  });

  it("confirmHandoff throws: cleanup pending, generic failure", async () => {
    const { deps, calls } = handoffDeps({
      confirmHandoff: async () => {
        throw new Error("rpc down");
      },
    });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
  });

  it("ensureAccessToken null: cleanup pending, no identity written", async () => {
    const { deps, calls } = handoffDeps({ ensureAccessToken: async () => null });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
    expect(calls.navigations).toBe(0);
    expect(calls.writtenIdentities).toHaveLength(0);
  });

  it("ensureAccessToken throws: cleanup pending, no identity written", async () => {
    const { deps, calls } = handoffDeps({
      ensureAccessToken: async () => {
        throw new Error("network");
      },
    });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
    expect(calls.writtenIdentities).toHaveLength(0);
  });

  it("getStorage null: cleanup pending, no identity written", async () => {
    const { deps, calls } = handoffDeps({ getStorage: () => null });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
    expect(calls.writtenIdentities).toHaveLength(0);
  });

  it("writeIdentity returns null: cleanup pending, no navigation", async () => {
    const { deps, calls } = handoffDeps();
    const broken: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    const r = await managerLoginHandoffCore(identity, {
      ...deps,
      getStorage: () => broken,
    });
    expect(r.ok).toBe(false);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
    expect(calls.navigations).toBe(0);
  });

  it("navigate throws: confirm never called, cleanup pending", async () => {
    const { deps, calls } = handoffDeps({
      navigate: () => {
        throw new Error("nav abort");
      },
    });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(calls.confirmations).toEqual([]);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);
  });

  // --- cleanupPending failure: still fails closed ---

  it("cleanupPending throws: still fails closed, no navigation", async () => {
    const { deps, calls } = handoffDeps({
      ensureAccessToken: async () => null,
      cleanupPending: async () => {
        throw new Error("cleanup rpc down");
      },
    });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(r.ok).toBe(false);
    expect(calls.navigations).toBe(0);
  });

  // --- Retry yields exactly one active session ---

  it("retry after failed confirmation: exactly one active session", async () => {
    let confirmFails = true;
    const { deps, calls } = handoffDeps({
      confirmHandoff: async (tok) => {
        calls.confirmations.push(tok);
        return !confirmFails;
      },
    });
    const first = await managerLoginHandoffCore(identity, deps);
    expect(first.ok).toBe(false);
    expect(calls.cleanups).toEqual(["pending-mgr-tok"]);

    confirmFails = false;
    const second = await managerLoginHandoffCore(identity, deps);
    expect(second).toEqual({ ok: true });
    // writeManagerIdentity uses setItem (same key) — second call overwrites.
    expect(calls.writtenIdentities.length).toBeGreaterThanOrEqual(1);
    expect(calls.writtenIdentities.at(-1)?.accessToken).toBe("anon-access-tok");
    // Both attempts navigate (first navigates then confirm fails, second navigates then confirms)
    expect(calls.navigations).toBe(2);
    expect(calls.confirmations).toEqual(["pending-mgr-tok", "pending-mgr-tok"]);
  });

  // --- Raw token never leaks ---

  it("raw token never appears in error messages", async () => {
    const { deps } = handoffDeps({
      confirmHandoff: async () => false,
    });
    const r = await managerLoginHandoffCore(identity, deps);
    expect(JSON.stringify(r)).not.toContain("pending-mgr-tok");
  });
});
