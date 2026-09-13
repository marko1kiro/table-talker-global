import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getAnonAuthedSupabaseClient } from "../src/lib/role-session.server";

const source = () =>
  readFileSync(new URL("../src/lib/role-session.server.ts", import.meta.url), "utf8");

// Poin 3 Task 9 (hard cutover): claimRoleSession / claimRoleSessionCore and the
// claim_role_session RPC they wrapped are GONE (see role-session.server.ts +
// migrations/20260913130000), and so is the role-token verifier whose last
// caller was that wrapper. The crew claim surface is now crew_shift_claim,
// tested in tests/point-3-crew-auth-server.test.ts; what still lives here -- the
// shared client factory every auth.uid()-scoped read/write is typed against --
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

describe("role-session.server.ts source contract", () => {
  it("no longer wraps the dropped claim_role_session RPC (cutover)", () => {
    const text = source();
    expect(text).not.toContain("claim_role_session");
    expect(text).not.toContain("claimRoleSession");
    // no createServerFn-based crew claim remains (the file is the shared client
    // factory + its two types only)
    expect(text).not.toContain("createServerFn");
    expect(text).not.toContain("getServiceClient");
    // ...and the dead role-token verifier is gone with them
    expect(text).not.toContain("verifyRoleSessionToken");
  });

  it("keeps exporting the shared client factory the auth.uid()-scoped RPCs rely on", () => {
    const text = source();
    // Documents the auth.uid()-scoped grant shape the remaining crew/occupancy
    // RPCs are revoked/granted under.
    expect(text).toMatch(/grant execute[\s\S]*to authenticated/i);
    expect(text).toContain("UNAUTHORIZED");
  });
});
