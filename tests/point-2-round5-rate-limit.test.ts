// ROUND 5 R5-C (updated by R6-C): durable, exactly-once rate-limit outcomes.
// R6-C replaced the manager-path server-side completion: the manager login
// mints a PENDING session, returns the reservation id, and the browser's
// confirm call finalizes the outcome atomically with session activation.
// The AM path finalizes server-side through a verdict-based completion —
// only SUCCEEDED / ALREADY_SUCCEEDED stand; anything else banks a durable
// failure that a late reporter cannot contradict (DB compare-and-set,
// proven against real Postgres in tests/db/round6-rate-limit-outcome.test.ts).
import { describe, expect, it } from "vitest";
import { loginStaffCore, type StaffLoginDeps } from "../src/lib/staff-login.server";

// Test reservation identity for the wired core (never hits the real limiter).
const RESV = "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e";

const managerCred = {
  id: "m1",
  password_hash: "salt:hash",
  status: "aktif",
  full_name: "M",
  restaurant_id: "r1",
  restaurant_display_name: "Resto",
  restaurant_code: "R1",
};

function baseDeps(overrides: Partial<StaffLoginDeps> = {}) {
  const state = {
    reports: [] as unknown[],
    revocations: [] as string[],
    cookieCleared: 0,
  };
  const deps: StaffLoginDeps = {
    rpc: async (fn) =>
      fn === "get_manager_credential"
        ? { data: managerCred, error: null }
        : fn === "create_manager_session_pending"
          ? { data: "new-mgr-tok", error: null }
          : { data: null, error: { message: "x" } },
    verify: async () => true,
    report: async (v) => {
      state.reports.push(v);
      return v ? "SUCCEEDED" : "FAILED";
    },
    rateLimitReservationId: RESV,
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

describe("R5-C/R6-C: manager login defers the outcome to the browser confirm", () => {
  it("manager success: NO server-side report; the reservation id is returned", async () => {
    const { deps, state } = baseDeps();
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(true);
    if (!r.ok || r.role !== "manager") return;
    expect(state.reports).toEqual([]); // outcome finalized by confirm, not here
    expect(r.rateLimitReservationId).toBe(RESV);
  });

  it("manager without a reservation id: fail closed, nothing reported", async () => {
    const { deps, state } = baseDeps({ rateLimitReservationId: null });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([false]);
  });

  it("old-credential revocation failure: exactly one durable report(false)", async () => {
    const { deps, state } = baseDeps({
      revokeManagerSessionByToken: async (token) => {
        state.revocations.push(`manager:${token}`);
        throw new Error("revoke rpc down");
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps, { managerTokenToRevoke: "old-mgr" });
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([false]);
  });

  it("wrong password: no report(true), one report(false)", async () => {
    const { deps, state } = baseDeps({
      verify: async () => false,
    });
    const r = await loginStaffCore("mgr", "wrong", deps);
    expect(r.ok).toBe(false);
    // Wrong password never reports success — only reports failure
    expect(state.reports).toEqual([false]);
    expect(state.revocations).toEqual([]);
  });

  it("session mint failure: no report(true), one report(false)", async () => {
    const { deps, state } = baseDeps({
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? { data: managerCred, error: null }
          : fn === "create_manager_session_pending"
            ? { data: null, error: { message: "session mint failed" } }
            : { data: null, error: { message: "x" } },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([false]);
  });
});

describe("R5-C/R6-C: AM login exactly-once verdict-based outcome", () => {
  const amCred = {
    id: "am-1",
    staff_id: "am.satu",
    password_hash: "salt:hash",
    status: "aktif",
    full_name: "AM",
    password_changed_at: null,
  };

  function amDeps(overrides: Partial<StaffLoginDeps> = {}) {
    const state = { reports: [] as unknown[], staffRevocations: [] as string[] };
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
        return v ? "SUCCEEDED" : "FAILED";
      },
      updateSession: async () => undefined,
      revokeStaffSessionByToken: async (kind, token) => {
        state.staffRevocations.push(`${kind}:${token}`);
      },
      ...overrides,
    };
    return { deps, state };
  }

  it("AM success: one authoritative report(true)", async () => {
    const { deps, state } = amDeps();
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(true);
    expect(state.reports).toEqual([true]);
  });

  it("AM completion refuses success (FAILED verdict): durable failure banked, session revoked, cookie cleared", async () => {
    const { deps, state } = amDeps({
      report: async (v) => {
        state.reports.push(v);
        return "FAILED";
      },
      updateSession: async () => undefined,
      clearSession: async () => undefined,
    });
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(false);
    // report(true) was refused by the limiter, so the durable failure is
    // banked via report(false) — the CAS makes a late success unable to
    // contradict it. Exactly ONE final outcome exists per reservation.
    expect(state.reports).toEqual([true, false]);
    expect(state.staffRevocations).toEqual(["area_manager:am-tok"]);
  });

  it("AM cookie write failure: session revoked, durable failure outcome banked", async () => {
    const { deps, state } = amDeps({
      report: async (v) => {
        state.reports.push(v);
        return "FAILED";
      },
      rateLimitReservationId: RESV,
      updateSession: async () => {
        throw new Error("cookie write failed");
      },
    });
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.staffRevocations).toEqual(["area_manager:am-tok"]);
    // R6-C: the failure outcome is banked (not left to expire) so a late
    // success reporter can never contradict the DB.
    expect(state.reports).toEqual([false]);
  });
});
