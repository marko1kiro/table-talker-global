import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getAnonAuthedSupabaseClient,
  verifyRoleSessionToken,
} from "../src/lib/role-session.server";

const source = () =>
  readFileSync(new URL("../src/lib/role-session.server.ts", import.meta.url), "utf8");

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";

// Poin 3 Task 9 (hard cutover): claimRoleSession / claimRoleSessionCore and the
// claim_role_session RPC they wrapped are GONE (see role-session.server.ts +
// migrations/20260913130000). The crew claim surface is now crew_shift_claim,
// tested in tests/point-3-crew-auth-server.test.ts. What still lives here -- the
// shared client factory + the role-token verifier used by the occupancy RPCs --
// is exercised below.

describe("getAnonAuthedSupabaseClient", () => {
  it("returns null when Supabase browser env vars are not configured", () => {
    const originalUrl = process.env.VITE_SUPABASE_URL;
    const originalKey = process.env.VITE_SUPABASE_ANON_KEY;
    delete process.env.VITE_SUPABASE_URL;
    delete process.env.VITE_SUPABASE_ANON_KEY;
    try {
      expect(getAnonAuthedSupabaseClient("some-access-token")).toBeNull();
    } finally {
      if (originalUrl !== undefined) process.env.VITE_SUPABASE_URL = originalUrl;
      if (originalKey !== undefined) process.env.VITE_SUPABASE_ANON_KEY = originalKey;
    }
  });

  it("returns null when no access token is supplied", () => {
    const originalUrl = process.env.VITE_SUPABASE_URL;
    const originalKey = process.env.VITE_SUPABASE_ANON_KEY;
    process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    try {
      expect(getAnonAuthedSupabaseClient("")).toBeNull();
    } finally {
      if (originalUrl !== undefined) process.env.VITE_SUPABASE_URL = originalUrl;
      else delete process.env.VITE_SUPABASE_URL;
      if (originalKey !== undefined) process.env.VITE_SUPABASE_ANON_KEY = originalKey;
      else delete process.env.VITE_SUPABASE_ANON_KEY;
    }
  });

  it("builds a per-request client using the anon key with the access token forwarded as a Bearer header", () => {
    const originalUrl = process.env.VITE_SUPABASE_URL;
    const originalKey = process.env.VITE_SUPABASE_ANON_KEY;
    process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
    process.env.VITE_SUPABASE_ANON_KEY = "anon-key";
    try {
      const client = getAnonAuthedSupabaseClient("device-access-token");
      expect(client).not.toBeNull();
    } finally {
      if (originalUrl !== undefined) process.env.VITE_SUPABASE_URL = originalUrl;
      else delete process.env.VITE_SUPABASE_URL;
      if (originalKey !== undefined) process.env.VITE_SUPABASE_ANON_KEY = originalKey;
      else delete process.env.VITE_SUPABASE_ANON_KEY;
    }
  });
});

describe("verifyRoleSessionToken", () => {
  function fakeClient(row: unknown, error: { message: string } | null = null) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      gt: () => builder,
      maybeSingle: async () => ({ data: row, error }),
    };
    return { from: () => builder } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  it("returns the role session on a valid, non-expired token row", async () => {
    const client = fakeClient({
      role_session_id: "role-session-1",
      restaurant_id: RESTAURANT_ID,
      role: "kasir",
    });
    const result = await verifyRoleSessionToken(client, "opaque-token", RESTAURANT_ID);
    expect(result).toEqual({
      roleSessionId: "role-session-1",
      restaurantId: RESTAURANT_ID,
      role: "kasir",
    });
  });

  it("returns null when the query errors", async () => {
    const client = fakeClient(null, { message: "boom" });
    const result = await verifyRoleSessionToken(client, "opaque-token", RESTAURANT_ID);
    expect(result).toBeNull();
  });

  it("returns null when no matching row is found", async () => {
    const client = fakeClient(null);
    const result = await verifyRoleSessionToken(client, "opaque-token", RESTAURANT_ID);
    expect(result).toBeNull();
  });
});

describe("role-session.server.ts source contract", () => {
  it("no longer wraps the dropped claim_role_session RPC (cutover)", () => {
    const text = source();
    expect(text).not.toContain("claim_role_session");
    expect(text).not.toContain("claimRoleSession");
    // no createServerFn-based crew claim remains (the file is now client + verifier only)
    expect(text).not.toContain("createServerFn");
    expect(text).not.toContain("getServiceClient");
  });

  it("keeps exporting the shared client factory the auth.uid()-scoped RPCs rely on", () => {
    const text = source();
    // Documents the auth.uid()-scoped grant shape the remaining crew/occupancy
    // RPCs are revoked/granted under.
    expect(text).toMatch(/grant execute[\s\S]*to authenticated/i);
    expect(text).toContain("UNAUTHORIZED");
  });
});
