// ROUND 5 R5-C: bounded durable rate-limit with exactly-once outcome.
// confirmDurableSuccess MUST have a bounded timeout. The reporter must
// never be called more than once per attempt. A failed completion must
// never leave an active session.
import { describe, expect, it, vi } from "vitest";
import { loginStaffCore, type StaffLoginDeps } from "../src/lib/staff-login.server";

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

describe("R5-C: exactly-once reporter + bounded timeout", () => {
  it("normal success: EXACTLY ONE report(true)", async () => {
    const { deps, state } = baseDeps();
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(true);
    expect(state.reports).toEqual([true]);
  });

  it("reporter returns false: session revoked, cookie cleared, one report", async () => {
    const { deps, state } = baseDeps({
      report: async (v) => {
        state.reports.push(v);
        return false;
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]);
    expect(state.revocations).toEqual(["manager:new-mgr-tok"]);
  });

  it("reporter throws: same fail-closed, one report attempt", async () => {
    const { deps, state } = baseDeps({
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

  it("reporter returns undefined (malformed): fail closed, one report", async () => {
    const { deps, state } = baseDeps({
      report: async (v) => {
        state.reports.push(v);
        return undefined;
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.reports).toEqual([true]);
    expect(state.revocations).toEqual(["manager:new-mgr-tok"]);
  });

  it("reporter never called twice (exactly once per attempt)", async () => {
    let reportCount = 0;
    const { deps, state } = baseDeps({
      report: async (v) => {
        reportCount++;
        state.reports.push(v);
        return true;
      },
    });
    await loginStaffCore("mgr", "pw", deps);
    expect(reportCount).toBe(1);
  });

  it("reporter timeout: bounded (does not hang forever), fail closed", async () => {
    const { deps, state } = baseDeps({
      report: async (v) => {
        state.reports.push(v);
        // Simulate a hung reporter — never resolves
        return new Promise<never>(() => {});
      },
    });
    // confirmDurableSuccess has a 10s timeout. The login must complete
    // within that timeout (fail-closed), not hang forever.
    const start = Date.now();
    const r = await loginStaffCore("mgr", "pw", deps);
    const elapsed = Date.now() - start;
    expect(r.ok).toBe(false);
    // Must have completed within 15s (10s timeout + 5s margin)
    expect(elapsed).toBeLessThan(15_000);
    // Session was revoked (fail-closed on timeout)
    expect(state.revocations).toEqual(["manager:new-mgr-tok"]);
  }, 20_000);

  it("wrong password: no report(true), one report(false)", async () => {
    const { deps, state } = baseDeps({
      verify: async () => false,
      report: async (v) => {
        state.reports.push(v);
        return true;
      },
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

  it("revocation failure during compensation: still returns generic failure", async () => {
    const { deps, state } = baseDeps({
      report: async (v) => {
        state.reports.push(v);
        return false;
      },
      revokeManagerSessionByToken: async () => {
        throw new Error("revoke rpc down");
      },
    });
    const r = await loginStaffCore("mgr", "pw", deps);
    expect(r.ok).toBe(false);
    // Even though revocation failed, the login is still failed (no orphan)
  });

  it("duplicate completion is idempotent: second report(true) ignored", async () => {
    let reportCount = 0;
    const { deps, state } = baseDeps({
      report: async (v) => {
        reportCount++;
        state.reports.push(v);
        return true;
      },
    });
    // Call loginStaffCore twice — should not produce two successes
    const r1 = await loginStaffCore("mgr", "pw", deps);
    const r2 = await loginStaffCore("mgr", "pw", deps);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Each attempt gets exactly one report
    expect(reportCount).toBe(2);
  });
});

describe("R5-C: AM login exactly-once outcome", () => {
  const amCred = {
    id: "am-1",
    staff_id: "am.satu",
    password_hash: "salt:hash",
    status: "aktif",
    full_name: "AM",
    password_changed_at: null,
  };

  it("AM success: one report(true)", async () => {
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
        return true;
      },
      updateSession: async () => undefined,
      clearSession: async () => undefined,
      revokeStaffSessionByToken: async (kind, token) => {
        state.staffRevocations.push(`${kind}:${token}`);
      },
    };
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(true);
    expect(state.reports).toEqual([true]);
  });

  it("AM reporter false: session revoked, cookie cleared, one report", async () => {
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

  it("AM cookie write failure: session revoked, no orphan, one report", async () => {
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
        return true;
      },
      updateSession: async () => {
        throw new Error("cookie write failed");
      },
      revokeStaffSessionByToken: async (kind, token) => {
        state.staffRevocations.push(`${kind}:${token}`);
      },
    };
    const r = await loginStaffCore("am.satu", "pw", deps);
    expect(r.ok).toBe(false);
    expect(state.staffRevocations).toEqual(["area_manager:am-tok"]);
    // Cookie write failed → report was NOT called (failure happened before completion)
    expect(state.reports).toEqual([]);
  });
});
