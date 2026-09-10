// R6-C RED (unit): the manager login path must NOT finalize the rate-limit
// outcome server-side. The outcome is finalized atomically by the browser's
// confirm call (activation + completion in one DB transaction). The login
// response carries the reservation id for that purpose. Failures before the
// handoff complete DO record a durable failure outcome.
// Baseline a239081-lineage: loginStaffCore calls report(true) itself and never
// returns a reservation id — every test below fails.
import { describe, expect, test } from "vitest";
import { loginStaffCore, type StaffLoginDeps } from "../src/lib/staff-login.server";

function managerDeps(reportCalls: boolean[]) {
  const rpcCalls: string[] = [];
  const deps: StaffLoginDeps = {
    rpc: async (fn) => {
      rpcCalls.push(fn);
      if (fn === "get_manager_credential") {
        return {
          data: {
            id: "m1",
            password_hash: "salt:hash",
            status: "aktif",
            full_name: "Budi",
            restaurant_id: "r1",
            restaurant_display_name: "Resto",
            restaurant_code: "RESTO-1",
          },
          error: null,
        };
      }
      if (fn === "create_manager_session_pending") {
        return { data: "pending-token", error: null };
      }
      return { data: null, error: null };
    },
    report: async (valid) => {
      reportCalls.push(valid);
      return true;
    },
    verify: async () => true,
    managerExtras: async () => ({ password_changed_at: "set" }),
  };
  return { deps, rpcCalls };
}

describe("R6-C: manager login defers outcome finalization to confirm", () => {
  test("manager success: NO server-side report(true) and reservation id is returned", async () => {
    const reports: boolean[] = [];
    const { deps } = managerDeps(reports);
    const result = await loginStaffCore("budi.santoso", "pw", deps);
    expect(result.ok).toBe(true);
    if (!result.ok || result.role !== "manager") return;
    expect(reports).toEqual([]); // outcome is finalized by confirm, not here
    expect(result.rateLimitReservationId).toBeTruthy();
  });

  test("manager revocation-failure path records a durable failure outcome", async () => {
    const reports: boolean[] = [];
    const { deps } = managerDeps(reports);
    deps.revokeManagerSessionByToken = async () => {
      throw new Error("revocation transport down");
    };
    const result = await loginStaffCore("budi.santoso", "pw", deps, {
      managerTokenToRevoke: "old-token",
    });
    expect(result.ok).toBe(false);
    expect(reports).toEqual([false]); // durable failure accounting, exactly once
  });
});

describe("R6-C: AM login records durable outcomes", () => {
  test("cookie write failure records outcome=false (no unaccounted failure)", async () => {
    const reports: boolean[] = [];
    const deps: StaffLoginDeps = {
      rpc: async (fn) => {
        if (fn === "get_manager_credential") return { data: null, error: null };
        if (fn === "get_area_manager_credential") {
          return {
            data: {
              id: "am1",
              password_hash: "salt:hash",
              status: "aktif",
              full_name: "AM",
              staff_id: "am.kasir",
              password_changed_at: "set",
            },
            error: null,
          };
        }
        if (fn === "create_staff_session") return { data: "am-token", error: null };
        return { data: null, error: null };
      },
      report: async (valid) => {
        reports.push(valid);
        return true;
      },
      verify: async () => true,
      updateSession: async () => {
        throw new Error("cookie write exploded");
      },
    };
    const result = await loginStaffCore("am.kasir", "pw", deps);
    expect(result.ok).toBe(false);
    expect(reports).toEqual([false]); // R6-C: durable failure, not a swallowed outcome
  });
});
