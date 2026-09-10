import { describe, expect, it } from "vitest";
import { loginManagerCore, type ManagerAuthDeps } from "@/lib/manager-auth.server";

describe("R7-C manager reservation binding", () => {
  it("passes required reservation ID into pending session mint", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const deps: ManagerAuthDeps = {
      rpc: async (fn, params) => {
        calls.push([fn, params]);
        if (fn === "get_manager_credential") {
          return {
            data: {
              id: "m1",
              password_hash: "salt:hash",
              status: "aktif",
              full_name: "Budi Santoso",
              restaurant_id: "r1",
              restaurant_display_name: "Resto Satu",
              restaurant_code: "RESTO-1",
            },
            error: null,
          };
        }
        return { data: true, error: null };
      },
      verify: async () => true,
    };
    const input = {
      idManager: "budi.santoso",
      password: "pw",
      rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
    };
    await loginManagerCore(input, deps);
    expect(calls).toContainEqual([
      "create_manager_session_pending",
      {
        p_manager_id: "m1",
        p_reservation_id: "11111111-1111-4111-8111-111111111111",
        p_token: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
  });
});
