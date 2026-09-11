import { describe, expect, it, vi } from "vitest";
import {
  loginManagerCore,
  logoutManagerSessionCore,
  type ManagerAuthDeps,
} from "../src/lib/manager-auth.server";

function fakeVerify(pw: string, stored: string) {
  return Promise.resolve(stored === `hash(${pw})`);
}

describe("loginManagerCore", () => {
  const cred = {
    id: "m-1",
    password_hash: "hash(rahasia123)",
    status: "aktif",
    full_name: "Budi",
    restaurant_id: "r-1",
    restaurant_display_name: "Mie Gacoan KB",
    restaurant_code: "CKRBUL",
  };
  it("generic-fails on unknown id (no enumeration)", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: null, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore(
      {
        idManager: "ghost",
        password: "rahasia123",
        rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
      },
      deps,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_CREDENTIALS");
  });
  it("generic-fails on wrong password", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: cred, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore(
      {
        idManager: "budi",
        password: "nope",
        rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
      },
      deps,
    );
    expect(!r.ok && r.code).toBe("INVALID_CREDENTIALS");
  });
  it("fails for a nonaktif account", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: { ...cred, status: "nonaktif" }, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore(
      {
        idManager: "budi",
        password: "rahasia123",
        rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
      },
      deps,
    );
    expect(!r.ok && r.code).toBe("DISABLED");
  });
  it("returns the identity + token on success", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: cred, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "tok123", expiresAt: "2026-09-04T20:00:00Z" }),
    };
    const r = await loginManagerCore(
      {
        idManager: "budi",
        password: "rahasia123",
        rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
      },
      deps,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.managerToken).toBe("tok123");
      expect(r.restaurantId).toBe("r-1");
      expect(r.restaurantCode).toBe("CKRBUL");
    }
  });
});

describe("logoutManagerSessionCore", () => {
  const client = (verdict: unknown, error: { message: string } | null = null) => ({
    rpc: async (_fn: string, _params: Record<string, unknown>) => ({ data: verdict, error }),
  });

  it("uses the exact revoke RPC and parameter", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { verdict: "REVOKED" }, error: null });
    await expect(logoutManagerSessionCore({ rpc }, "manager-token")).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("revoke_manager_session_by_token", {
      p_token: "manager-token",
    });
  });

  it.each(["UNKNOWN_TOKEN", "KIND_MISMATCH", "OTHER", null])(
    "fails closed on non-success verdict %s",
    async (verdict) => {
      await expect(logoutManagerSessionCore(client({ verdict }), "manager-token")).resolves.toEqual({
        ok: false,
      });
    },
  );

  it.each(["REVOKED", "ALREADY_INACTIVE"])("accepts %s", async (verdict) => {
    await expect(logoutManagerSessionCore(client({ verdict }), "manager-token")).resolves.toEqual({
      ok: true,
    });
  });

  it("fails closed for no client, RPC error, and rejected RPC", async () => {
    await expect(logoutManagerSessionCore(null, "manager-token")).resolves.toEqual({ ok: false });
    await expect(
      logoutManagerSessionCore(client({ verdict: "REVOKED" }, { message: "offline" }), "manager-token"),
    ).resolves.toEqual({ ok: false });
    await expect(
      logoutManagerSessionCore(
        { rpc: async () => Promise.reject(new Error("offline")) },
        "manager-token",
      ),
    ).resolves.toEqual({ ok: false });
  });
});
