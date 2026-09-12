import { describe, expect, it, vi } from "vitest";
import { loginStaffCore, type StaffLoginDeps } from "@/lib/staff-login.server";

const reservationId = "11111111-1111-4111-8111-111111111111";
const managerCredential = {
  id: "m1",
  password_hash: "hash",
  status: "aktif",
  full_name: "Manager",
  restaurant_id: "r1",
  restaurant_display_name: "Resto",
  restaurant_code: "R1",
};

function base(overrides: Partial<StaffLoginDeps> = {}): StaffLoginDeps {
  return {
    rpc: async (fn) => {
      if (fn === "get_manager_credential") return { data: managerCredential, error: null };
      if (fn === "create_manager_session_pending") return { data: true, error: null };
      return { data: null, error: { message: "not found" } };
    },
    verify: async () => true,
    report: async () => "FAILED",
    rateLimitReservationId: reservationId,
    clearSession: async () => undefined,
    revokeStaffSessionByToken: async () => undefined,
    revokeManagerSessionByToken: async () => undefined,
    ...overrides,
  };
}

describe("R8 terminal login accounting", () => {
  it("banks one failure when manager credential transport throws", async () => {
    const report = vi.fn(async () => "FAILED" as const);
    const result = await loginStaffCore(
      "manager",
      "pw",
      base({
        rpc: async () => {
          throw new Error("credential transport down");
        },
        report,
      }),
    );
    expect(result).toEqual({ ok: false, message: expect.any(String) });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(false);
  });

  it("cleans pending and banks failure when shared-cookie clearing throws synchronously", async () => {
    const calls: string[] = [];
    const report = vi.fn(async () => "FAILED" as const);
    const deps = base({
      rpc: async (fn) => {
        calls.push(fn);
        if (fn === "get_manager_credential") return { data: managerCredential, error: null };
        if (fn === "create_manager_session_pending") return { data: true, error: null };
        if (fn === "cleanup_pending_manager_session") return { data: true, error: null };
        return { data: null, error: { message: "not found" } };
      },
      clearSession: () => {
        throw new Error("cookie unavailable");
      },
      report,
    });

    const result = await loginStaffCore("manager", "pw", deps);
    expect(result.ok).toBe(false);
    expect(calls).toContain("cleanup_pending_manager_session");
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(false);
  });

  it("banks one failure when AM session mint transport throws", async () => {
    const report = vi.fn(async () => "FAILED" as const);
    const result = await loginStaffCore(
      "area.manager",
      "pw",
      base({
        rpc: async (fn) => {
          if (fn === "get_manager_credential") return { data: null, error: null };
          if (fn === "get_area_manager_credential") {
            return {
              data: {
                id: "am1",
                password_hash: "hash",
                status: "aktif",
                full_name: "Area Manager",
                staff_id: "area.manager",
                password_changed_at: new Date().toISOString(),
              },
              error: null,
            };
          }
          if (fn === "create_staff_session") throw new Error("mint transport down");
          return { data: null, error: null };
        },
        report,
      }),
    );
    expect(result.ok).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(false);
  });
});
