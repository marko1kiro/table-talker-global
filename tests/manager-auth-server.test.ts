import { describe, expect, it } from "vitest";
import { loginManagerCore, type ManagerAuthDeps } from "../src/lib/manager-auth.server";

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
    const r = await loginManagerCore({ idManager: "ghost", password: "rahasia123" }, deps);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_CREDENTIALS");
  });
  it("generic-fails on wrong password", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: cred, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore({ idManager: "budi", password: "nope" }, deps);
    expect(!r.ok && r.code).toBe("INVALID_CREDENTIALS");
  });
  it("fails for a nonaktif account", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: { ...cred, status: "nonaktif" }, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "t", expiresAt: "e" }),
    };
    const r = await loginManagerCore({ idManager: "budi", password: "rahasia123" }, deps);
    expect(!r.ok && r.code).toBe("DISABLED");
  });
  it("returns the identity + token on success", async () => {
    const deps: ManagerAuthDeps = {
      rpc: async () => ({ data: cred, error: null }),
      verify: fakeVerify,
      createSession: async () => ({ token: "tok123", expiresAt: "2026-09-04T20:00:00Z" }),
    };
    const r = await loginManagerCore({ idManager: "budi", password: "rahasia123" }, deps);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.managerToken).toBe("tok123");
      expect(r.restaurantId).toBe("r-1");
      expect(r.restaurantCode).toBe("CKRBUL");
    }
  });
});
