// @vitest-environment jsdom
// Poin 3 Task 7: browser-auth is the ONLY browser Supabase client factory.
// Sessions live in localStorage (supabase-js default — no sessionStorage
// adapter is passed to createClient); token refresh is strictly getSession,
// never a sign-in attempt (the anonymous provider is banned forever).
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = {
  getSession: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  signInAnonymously: vi.fn(),
};
const fakeClient = { auth };

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => fakeClient),
}));

import { createClient } from "@supabase/supabase-js";
import {
  crewGetSession,
  crewSignInWithOtp,
  crewSignOut,
  crewVerifyOtp,
  getDeviceToken,
  getSupabaseBrowserClient,
  refreshCarrierToken,
  staffCarrierToken,
  staffSignInCarrier,
} from "../src/lib/browser-auth";

const session = (token: string) => ({ data: { session: { access_token: token } }, error: null });
const noSession = { data: { session: null }, error: null };

beforeEach(() => {
  localStorage.clear();
  import.meta.env.VITE_SUPABASE_URL = "https://unit.test.supabase.co";
  import.meta.env.VITE_SUPABASE_ANON_KEY = "unit-anon-key";
  vi.mocked(createClient).mockClear();
  auth.getSession.mockReset();
  auth.signInWithOtp.mockReset();
  auth.verifyOtp.mockReset();
  auth.signOut.mockReset();
  auth.signInWithPassword.mockReset();
});

describe("getSupabaseBrowserClient", () => {
  it("creates one client with default (localStorage) persistence — no storage adapter", () => {
    const client = getSupabaseBrowserClient();
    expect(client).toBeTruthy();
    expect(getSupabaseBrowserClient()).toBe(client);
    expect(createClient).toHaveBeenCalledTimes(1);
    // The banned old pattern passed an auth:{storage: sessionStorage} adapter;
    // the carrier/crew session must survive reloads via localStorage default.
    expect(vi.mocked(createClient).mock.calls[0]).toEqual([
      "https://unit.test.supabase.co",
      "unit-anon-key",
    ]);
  });
});

describe("getDeviceToken", () => {
  it("generates a uuid once and caches it under lm.device.v1", () => {
    const first = getDeviceToken();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem("lm.device.v1")).toBe(first);
    expect(getDeviceToken()).toBe(first);
  });

  it("regenerates and replaces a stored value that is not a 36-char uuid", () => {
    localStorage.setItem("lm.device.v1", "garbage");
    const fresh = getDeviceToken();
    expect(fresh).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh).not.toBe("garbage");
    expect(localStorage.getItem("lm.device.v1")).toBe(fresh);
  });
});

describe("refreshCarrierToken / staffCarrierToken", () => {
  it("returns the live session token from getSession WITHOUT any sign-in attempt", async () => {
    auth.getSession.mockResolvedValue(session("carrier-live-token"));
    expect(await refreshCarrierToken()).toBe("carrier-live-token");
    expect(await staffCarrierToken()).toBe("carrier-live-token");
    expect(auth.getSession).toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("null (never throws) when there is no session or getSession rejects", async () => {
    auth.getSession.mockResolvedValue(noSession);
    expect(await refreshCarrierToken()).toBeNull();
    auth.getSession.mockRejectedValue(new Error("network down"));
    expect(await refreshCarrierToken()).toBeNull();
    expect(await staffCarrierToken()).toBeNull();
  });
});

describe("staffSignInCarrier", () => {
  it("forwards email+password and reports success without throwing", async () => {
    auth.signInWithPassword.mockResolvedValue(session("carrier-token"));
    await expect(staffSignInCarrier("shadow+m-1@lihatmeja.com", "pw")).resolves.toEqual({
      ok: true,
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "shadow+m-1@lihatmeja.com",
      password: "pw",
    });
  });

  it("maps auth errors and thrown failures to {ok:false} only", async () => {
    auth.signInWithPassword.mockResolvedValue({ data: null, error: { message: "bad pw" } });
    expect(await staffSignInCarrier("a@b.c", "pw")).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    auth.signInWithPassword.mockRejectedValue(new Error("boom"));
    expect(await staffSignInCarrier("a@b.c", "pw")).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("crew OTP wrappers", () => {
  it("crewSignInWithOtp sends the email OTP", async () => {
    auth.signInWithOtp.mockResolvedValue({ data: null, error: null });
    expect(await crewSignInWithOtp("crew@example.com")).toEqual({ ok: true });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: "crew@example.com" });
  });

  it("crewVerifyOtp verifies an email-type OTP token", async () => {
    auth.verifyOtp.mockResolvedValue(session("crew-token"));
    expect(await crewVerifyOtp("crew@example.com", "123456")).toEqual({ ok: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      type: "email",
      email: "crew@example.com",
      token: "123456",
    });
  });

  it("crewVerifyOtp surfaces a wrong-code error as ok:false, never throws", async () => {
    auth.verifyOtp.mockResolvedValue({ data: null, error: { message: "invalid otp" } });
    expect(await crewVerifyOtp("crew@example.com", "000000")).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("crewSignOut and crewGetSession stay thin and non-throwing", async () => {
    auth.signOut.mockResolvedValue({ error: null });
    expect(await crewSignOut()).toEqual({ ok: true });
    auth.getSession.mockResolvedValue(session("crew-token"));
    expect(await crewGetSession()).toEqual({ ok: true, accessToken: "crew-token" });
    auth.getSession.mockRejectedValue(new Error("down"));
    expect(await crewGetSession()).toEqual({ ok: false, code: "UNAVAILABLE" });
    auth.signOut.mockRejectedValue(new Error("down"));
    expect(await crewSignOut()).toEqual({ ok: false, code: "UNAVAILABLE" });
  });
});
