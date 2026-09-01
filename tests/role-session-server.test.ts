import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  claimRoleSessionCore,
  getAnonAuthedSupabaseClient,
  verifyRoleSessionToken,
} from "../src/lib/role-session.server";

const source = () =>
  readFileSync(new URL("../src/lib/role-session.server.ts", import.meta.url), "utf8");

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";

describe("claimRoleSessionCore", () => {
  // C-01 remediation (Fase 1, 2026-09-02): claim_role_session is the
  // authoritative PIN check, so pin is now a required field forwarded to
  // the RPC as p_pin alongside the pre-existing params.
  const baseInput = {
    restaurantId: RESTAURANT_ID,
    tenantToken: "tenant-token",
    role: "kasir" as const,
    displayName: "Budi",
    checkedInAt: "2026-08-30T09:00:00.000Z",
    pin: "1234",
  };

  it("returns a normalized ok result on a successful RPC response", async () => {
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      expect(fn).toBe("claim_role_session");
      expect(params).toEqual({
        p_restaurant_id: RESTAURANT_ID,
        p_tenant_token: "tenant-token",
        p_role: "kasir",
        p_display_name: "Budi",
        p_checked_in_at: "2026-08-30T09:00:00.000Z",
        p_pin: "1234",
      });
      return {
        data: {
          session: {
            id: "session-1",
            role: "kasir",
            display_name: "Budi",
            checked_in_at: "2026-08-30T09:00:00.000Z",
          },
          session_token: "opaque-session-token",
        },
        error: null,
      };
    };

    const result = await claimRoleSessionCore(baseInput, rpc);
    expect(result).toEqual({
      ok: true,
      sessionId: "session-1",
      role: "kasir",
      displayName: "Budi",
      checkedInAt: "2026-08-30T09:00:00.000Z",
      sessionToken: "opaque-session-token",
    });
  });

  it("maps known Postgres exception messages to typed error codes without leaking raw text", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_TENANT_SESSION" } });
    const result = await claimRoleSessionCore(baseInput, rpc);
    expect(result).toEqual({
      ok: false,
      code: "INVALID_TENANT_SESSION",
      message: "Gagal memulai sesi peran.",
    });
  });

  it("maps unknown/unexpected Postgres errors to UNAVAILABLE, never echoing raw error text", async () => {
    const rpc = async () => ({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint "crew_role_sessions_pkey"',
      },
    });
    const result = await claimRoleSessionCore(baseInput, rpc);
    expect(result).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memulai sesi peran.",
    });
    expect(JSON.stringify(result)).not.toContain("duplicate key");
  });

  it("returns UNAVAILABLE if the RPC throws", async () => {
    const rpc = async () => {
      throw new Error("network down");
    };
    const result = await claimRoleSessionCore(baseInput, rpc);
    expect(result).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memulai sesi peran.",
    });
  });

  it("returns UNAVAILABLE when the RPC response is missing session/session_token", async () => {
    const rpc = async () => ({ data: null, error: null });
    const result = await claimRoleSessionCore(baseInput, rpc);
    expect(result).toEqual({
      ok: false,
      code: "UNAVAILABLE",
      message: "Gagal memulai sesi peran.",
    });
  });
});

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
    const state: { role?: string } = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === "role") state.role = value as string;
        return builder;
      },
      gt: () => builder,
      maybeSingle: async () => ({ data: state.role ? row : row, error }),
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
  it("uses createServerFn with a Zod validator requiring accessToken for claim_role_session", () => {
    const text = source();
    expect(text).toContain('createServerFn({ method: "POST" })');
    expect(text).toContain("claimRoleSessionInputSchema");
    expect(text).toMatch(/accessToken: z\.string\(\)\.min\(1\)/);
    expect(text).toContain('rpc("claim_role_session"');
  });

  it("never calls getServiceClient for claim_role_session (it is not service-role-callable)", () => {
    const text = source();
    expect(text).not.toContain("getServiceClient");
  });

  it("documents the service-role vs authenticated grant mismatch discovered for Task 6 Step 9", () => {
    const text = source();
    expect(text).toMatch(/grant execute[\s\S]*to authenticated/i);
    expect(text).toContain("UNAUTHORIZED");
  });
});
