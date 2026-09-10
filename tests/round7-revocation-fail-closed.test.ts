import { describe, expect, it } from "vitest";
import { loginStaffCore, type StaffLoginDeps } from "@/lib/staff-login.server";

const baseDeps = (revoked: string[]): StaffLoginDeps => ({
  rpc: async (fn) =>
    fn === "get_manager_credential"
      ? {
          data: {
            id: "m1",
            password_hash: "salt:hash",
            status: "aktif",
            full_name: "Manager",
            restaurant_id: "r1",
            restaurant_display_name: "Resto",
            restaurant_code: "R1",
          },
          error: null,
        }
      : fn === "create_manager_session_pending"
        ? { data: "pending-token", error: null }
        : { data: null, error: null },
  verify: async () => true,
  report: async () => "FAILED",
  rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
  revokeManagerSessionByToken: async (_token, opts) => {
    revoked.push(JSON.stringify(opts));
    throw new Error("UNKNOWN_TOKEN");
  },
  revokeStaffSessionByToken: async () => undefined,
  clearSession: async () => undefined,
});

describe("R7-B mandatory manager switch revocation", () => {
  it("fails closed on UNKNOWN_TOKEN and never passes tolerateUnknown", async () => {
    const revoked: string[] = [];
    const result = await loginStaffCore("manager", "pw", baseDeps(revoked), {
      managerTokenToRevoke: "old-manager-token",
    });
    expect(result.ok).toBe(false);
    expect(revoked).toEqual([undefined]);
  });
});
