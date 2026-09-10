// R6-A RED: the real manager login path must mint a PENDING session via
// create_manager_session_pending. On baseline a239081 the default path still
// calls create_manager_session, which inserts an immediately-USABLE active
// session server-side (12h) — the browser handoff never gates usability.
import { describe, expect, test } from "vitest";
import { loginManagerCore, type ManagerAuthDeps } from "../src/lib/manager-auth.server";

describe("R6-A: manager login mints pending, never active", () => {
  test("default login path calls create_manager_session_pending", async () => {
    const calls: string[] = [];
    const deps: ManagerAuthDeps = {
      rpc: async (fn) => {
        calls.push(fn);
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
        return { data: "pending-token", error: null };
      },
      verify: async () => true,
    };

    const result = await loginManagerCore(
      {
        idManager: "budi.santoso",
        password: "pw",
        rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
      },
      deps,
    );
    expect(result.ok).toBe(true);
    expect(calls).toContain("create_manager_session_pending");
    expect(calls).not.toContain("create_manager_session");
  });
});
