// Poin 6.1 S3: password sign-in classification (INVALID_CREDENTIALS must be
// distinguishable from transport death) + set-password weak mapping.
import { beforeEach, describe, expect, test, vi } from "vitest";

const authStub = {
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  onAuthStateChange: vi.fn(() => ({
    data: { subscription: { unsubscribe: () => {} } },
  })),
};
const clientStub = { auth: authStub, realtime: { setAuth: vi.fn(() => Promise.resolve()) } };

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => clientStub,
}));

import { crewSetPassword, crewSignInWithPassword } from "@/lib/browser-auth";

beforeEach(() => {
  import.meta.env.VITE_SUPABASE_URL = "https://example.supabase.co";
  import.meta.env.VITE_SUPABASE_ANON_KEY = "anon";
  authStub.signInWithPassword.mockReset();
  authStub.updateUser.mockReset();
});

function err(status: number | undefined, message: string) {
  return { error: Object.assign(new Error(message), { status }) };
}

describe("crewSignInWithPassword", () => {
  test("success", async () => {
    authStub.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    await expect(crewSignInWithPassword("b@ex.test", "rahasia1")).resolves.toEqual({ ok: true });
    expect(authStub.signInWithPassword).toHaveBeenCalledWith({
      email: "b@ex.test",
      password: "rahasia1",
    });
  });

  test("wrong credentials => INVALID_CREDENTIALS (not UNAVAILABLE)", async () => {
    authStub.signInWithPassword.mockResolvedValue(err(undefined, "Invalid login credentials"));
    await expect(crewSignInWithPassword("b@ex.test", "salah")).resolves.toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
  });

  test("429 => RATE_LIMITED", async () => {
    authStub.signInWithPassword.mockResolvedValue(err(429, "too many requests"));
    await expect(crewSignInWithPassword("b@ex.test", "x")).resolves.toEqual({
      ok: false,
      code: "RATE_LIMITED",
    });
  });

  test("network throw => UNAVAILABLE", async () => {
    authStub.signInWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(crewSignInWithPassword("b@ex.test", "x")).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("crewSetPassword", () => {
  test("updateUser ok", async () => {
    authStub.updateUser.mockResolvedValue({ data: {}, error: null });
    await expect(crewSetPassword("rahasia1")).resolves.toEqual({ ok: true });
    expect(authStub.updateUser).toHaveBeenCalledWith({ password: "rahasia1" });
  });

  test("below-minimum message => WEAK (client shows local copy)", async () => {
    authStub.updateUser.mockResolvedValue(
      err(undefined, "Password should be at least 6 characters"),
    );
    await expect(crewSetPassword("123")).resolves.toEqual({ ok: false, code: "WEAK" });
  });

  test("network throw => UNAVAILABLE", async () => {
    authStub.updateUser.mockRejectedValue(new TypeError("offline"));
    await expect(crewSetPassword("rahasia1")).resolves.toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});
