import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { createSessionStorageAdapter } from "../src/lib/crew-session-identity";
import { ensureAnonAccessToken } from "../src/lib/supabase-browser";

const source = readFileSync(new URL("../src/lib/supabase-browser.ts", import.meta.url), "utf8");

it("uses the safe sessionStorage auth adapter with persistence and refresh enabled", () => {
  expect(source).toContain("createSessionStorageAdapter(browserSessionStorage())");
  expect(source).toContain("persistSession: true");
  expect(source).toContain("autoRefreshToken: true");
});

it("returns null rather than throwing for unavailable browser storage", () => {
  const adapter = createSessionStorageAdapter(null);
  expect(adapter.getItem("supabase.auth.token")).toBeNull();
  expect(() => adapter.setItem("supabase.auth.token", "token")).not.toThrow();
  expect(() => adapter.removeItem("supabase.auth.token")).not.toThrow();
});

function fakeClient({
  existingToken = null as string | null,
  signInToken = "fresh-anon-token",
  signInFails = false,
}: {
  existingToken?: string | null;
  signInToken?: string;
  signInFails?: boolean;
} = {}) {
  const getSession = vi.fn(async () => ({
    data: { session: existingToken ? { access_token: existingToken } : null },
    error: null,
  }));
  const signInAnonymously = vi.fn(async () =>
    signInFails
      ? { data: { session: null }, error: { message: "anonymous sign-ins are disabled" } }
      : { data: { session: { access_token: signInToken } }, error: null },
  );
  return { auth: { getSession, signInAnonymously } } as unknown as import("@supabase/supabase-js").SupabaseClient;
}

it("reuses an already-persisted session's access token without signing in again", async () => {
  const client = fakeClient({ existingToken: "persisted-token" });
  const token = await ensureAnonAccessToken(client);
  expect(token).toBe("persisted-token");
  expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
});

it("signs in anonymously once per device when no session is persisted yet", async () => {
  const client = fakeClient({ existingToken: null, signInToken: "brand-new-token" });
  const token = await ensureAnonAccessToken(client);
  expect(token).toBe("brand-new-token");
  expect(client.auth.signInAnonymously).toHaveBeenCalledOnce();
});

it("returns null when the client is unavailable (missing env vars)", async () => {
  expect(await ensureAnonAccessToken(null)).toBeNull();
});

it("returns null when anonymous sign-in fails, never throwing", async () => {
  const client = fakeClient({ existingToken: null, signInFails: true });
  expect(await ensureAnonAccessToken(client)).toBeNull();
});

it("returns null when getSession itself throws", async () => {
  const client = {
    auth: {
      getSession: vi.fn(async () => {
        throw new Error("network down");
      }),
      signInAnonymously: vi.fn(),
    },
  } as unknown as import("@supabase/supabase-js").SupabaseClient;
  expect(await ensureAnonAccessToken(client)).toBeNull();
  expect(client.auth.signInAnonymously).not.toHaveBeenCalled();
});
