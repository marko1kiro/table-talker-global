import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  crewAccountListCore,
  crewAccountResetCore,
  crewClaimShiftCore,
  crewConfirmPairingCore,
  crewMeCore,
  crewPairingListCore,
  crewPairingRejectCore,
  crewRequestPairingCore,
  crewSessionsEndCore,
  crewValidateCodeCore,
  generatePairingOtp,
  crewClaimShiftInputSchema,
  crewConfirmPairingInputSchema,
  crewRequestPairingInputSchema,
  crewValidateCodeInputSchema,
} from "../src/lib/crew-auth.server";
import { decryptEnvelopeHex, encryptEnvelopeHex } from "../src/lib/app-envelope-crypto.server";

const source = () =>
  readFileSync(new URL("../src/lib/crew-auth.server.ts", import.meta.url), "utf8");

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const AUTH_UID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const KEY = Buffer.alloc(32, 7).toString("base64");

const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

type RpcReply = { data: unknown; error: { message: string } | null };
function rpcReturning(reply: RpcReply) {
  const calls: Array<{ fn: string; params: Record<string, unknown> }> = [];
  const rpc = async (fn: string, params: Record<string, unknown>) => {
    calls.push({ fn, params });
    return reply;
  };
  return { rpc, calls };
}
function rpcThrowing(message: string) {
  return rpcReturning({ data: null, error: { message } });
}

beforeAll(() => {
  process.env.QR_EXPORT_ENCRYPTION_KEY = KEY;
});
afterAll(() => {
  delete process.env.QR_EXPORT_ENCRYPTION_KEY;
});

describe("crewValidateCodeCore", () => {
  it("calls crew_validate_code and normalizes the payload", async () => {
    const { rpc, calls } = rpcReturning({
      data: { restaurant_id: RESTAURANT_ID, display_name: "RM Sederhana" },
      error: null,
    });
    expect(await crewValidateCodeCore({ code: " RM01 " }, rpc)).toEqual({
      ok: true,
      restaurantId: RESTAURANT_ID,
      displayName: "RM Sederhana",
    });
    expect(calls[0]).toEqual({ fn: "crew_validate_code", params: { p_code: " RM01 " } });
  });

  it("maps raised INVALID_CODE / UNAUTHORIZED exactly, unknown errors to UNAVAILABLE", async () => {
    for (const code of ["INVALID_CODE", "UNAUTHORIZED"] as const) {
      const { rpc } = rpcThrowing(code);
      const result = await crewValidateCodeCore({ code: "RM01" }, rpc);
      expect(result).toMatchObject({ ok: false, code });
      expect(typeof (result as { message: string }).message).toBe("string");
    }
    const { rpc } = rpcThrowing('duplicate key value violates "restaurants_pkey"');
    const result = await crewValidateCodeCore({ code: "RM01" }, rpc);
    expect(result).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("duplicate key");
  });

  it("returns UNAVAILABLE for malformed success payloads and thrown exceptions", async () => {
    const malformed = rpcReturning({ data: { display_name: "no id" }, error: null });
    expect(await crewValidateCodeCore({ code: "RM01" }, malformed.rpc)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    const boom = async () => {
      throw new Error("network down");
    };
    expect(await crewValidateCodeCore({ code: "RM01" }, boom)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("crewRequestPairingCore", () => {
  it("hashes and encrypts the OTP server-side and returns the request id", async () => {
    const { rpc, calls } = rpcReturning({
      data: { ok: true, request_id: REQUEST_ID },
      error: null,
    });
    const result = await crewRequestPairingCore(
      { restaurantId: RESTAURANT_ID, fullName: "Budi", otp: "123456" },
      rpc,
    );
    expect(result).toEqual({ ok: true, requestId: REQUEST_ID });
    expect(calls[0].fn).toBe("crew_request_pairing");
    const params = calls[0].params;
    expect(params).toEqual({
      p_restaurant_id: RESTAURANT_ID,
      p_full_name: "Budi",
      p_otp_hash: sha256Hex("123456"),
      p_otp_encrypted: expect.stringMatching(/^4c494d4551523031[0-9a-f]+$/),
    });
    expect(decryptEnvelopeHex(String(params.p_otp_encrypted), KEY)).toBe("123456");
    expect(JSON.stringify(params)).not.toContain('"123456"');
  });

  it("maps every raised pairing verdict exactly", async () => {
    for (const code of [
      "ALREADY_PAIRED",
      "INVALID_NAME",
      "INVALID_CODE",
      "INTERNAL",
      "UNAUTHORIZED",
    ] as const) {
      const { rpc } = rpcThrowing(code);
      const result = await crewRequestPairingCore(
        { restaurantId: RESTAURANT_ID, fullName: "Budi", otp: "000001" },
        rpc,
      );
      expect(result).toMatchObject({ ok: false, code });
    }
    const { rpc } = rpcThrowing("unexpected");
    expect(
      await crewRequestPairingCore(
        { restaurantId: RESTAURANT_ID, fullName: "Budi", otp: "000001" },
        rpc,
      ),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("fails closed (UNAVAILABLE) when the envelope key is not configured", async () => {
    const saved = process.env.QR_EXPORT_ENCRYPTION_KEY;
    delete process.env.QR_EXPORT_ENCRYPTION_KEY;
    try {
      const { rpc } = rpcReturning({ data: { ok: true, request_id: REQUEST_ID }, error: null });
      expect(
        await crewRequestPairingCore(
          { restaurantId: RESTAURANT_ID, fullName: "Budi", otp: "123456" },
          rpc,
        ),
      ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    } finally {
      process.env.QR_EXPORT_ENCRYPTION_KEY = saved;
    }
  });

  it("returns UNAVAILABLE when the RPC verdict is malformed", async () => {
    const { rpc } = rpcReturning({ data: { ok: false }, error: null });
    expect(
      await crewRequestPairingCore(
        { restaurantId: RESTAURANT_ID, fullName: "Budi", otp: "123456" },
        rpc,
      ),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("generatePairingOtp", () => {
  it("always yields exactly six digits", async () => {
    for (let i = 0; i < 200; i++) {
      expect(await generatePairingOtp()).toMatch(/^[0-9]{6}$/);
    }
  });
});

describe("crewConfirmPairingCore", () => {
  it("hashes the input OTP and forwards it as p_otp_hash", async () => {
    const { rpc, calls } = rpcReturning({ data: { ok: true }, error: null });
    expect(await crewConfirmPairingCore({ requestId: REQUEST_ID, otp: "123456" }, rpc)).toEqual({
      ok: true,
    });
    expect(calls[0]).toEqual({
      fn: "crew_confirm_pairing",
      params: { p_request_id: REQUEST_ID, p_otp_hash: sha256Hex("123456") },
    });
  });

  it("maps returned business verdicts", async () => {
    for (const code of [
      "EXPIRED",
      "NOT_PENDING",
      "INVALID_OTP",
      "TOO_MANY_ATTEMPTS",
      "INVALID_CODE",
    ] as const) {
      const { rpc } = rpcReturning({ data: { ok: false, error: code }, error: null });
      expect(await crewConfirmPairingCore({ requestId: REQUEST_ID, otp: "123456" }, rpc)).toEqual({
        ok: false,
        code,
        message: expect.any(String),
      });
    }
  });

  it("maps raised NOT_FOUND / UNAUTHORIZED and unknown verdicts", async () => {
    for (const code of ["NOT_FOUND", "UNAUTHORIZED"] as const) {
      const { rpc } = rpcThrowing(code);
      expect(
        await crewConfirmPairingCore({ requestId: REQUEST_ID, otp: "123456" }, rpc),
      ).toMatchObject({ ok: false, code });
    }
    const { rpc } = rpcReturning({ data: { ok: false, error: "WHATEVER" }, error: null });
    expect(
      await crewConfirmPairingCore({ requestId: REQUEST_ID, otp: "123456" }, rpc),
    ).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("crewMeCore", () => {
  it("normalizes an unpaired probe", async () => {
    const { rpc, calls } = rpcReturning({ data: { paired: false }, error: null });
    expect(await crewMeCore({ deviceToken: "a".repeat(16) }, rpc)).toEqual({
      ok: true,
      paired: false,
      status: null,
      fullName: null,
      restaurantId: null,
      restaurantName: null,
      deviceCurrent: false,
    });
    expect(calls[0]).toEqual({ fn: "crew_me", params: { p_device_token: "a".repeat(16) } });
  });

  it("normalizes a paired account row", async () => {
    const { rpc } = rpcReturning({
      data: {
        paired: true,
        status: "aktif",
        full_name: "Budi",
        restaurant_id: RESTAURANT_ID,
        restaurant_name: "RM Sederhana",
        device_current: true,
      },
      error: null,
    });
    expect(await crewMeCore({ deviceToken: "a".repeat(16) }, rpc)).toEqual({
      ok: true,
      paired: true,
      status: "aktif",
      fullName: "Budi",
      restaurantId: RESTAURANT_ID,
      restaurantName: "RM Sederhana",
      deviceCurrent: true,
    });
  });

  it("maps UNAUTHORIZED and malformed payloads", async () => {
    const { rpc } = rpcThrowing("UNAUTHORIZED");
    expect(await crewMeCore({ deviceToken: "a".repeat(16) }, rpc)).toMatchObject({
      ok: false,
      code: "UNAUTHORIZED",
    });
    const malformed = rpcReturning({ data: { nonsense: true }, error: null });
    expect(await crewMeCore({ deviceToken: "a".repeat(16) }, malformed.rpc)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("crewClaimShiftCore", () => {
  const input = {
    role: "kasir" as const,
    checkedInAt: "2026-09-13T09:00:00.000Z",
    deviceToken: "d".repeat(32),
  };
  const okPayload = {
    session: {
      id: "session-1",
      role: "kasir",
      display_name: "Budi",
      checked_in_at: "2026-09-13T09:00:00.000Z",
    },
    session_token: "opaque-session-token",
    tenant_token: "opaque-tenant-token",
    restaurant_id: RESTAURANT_ID,
    restaurant_name: "RM Sederhana",
    restaurant_code: "RMSED01",
  };

  it("parses the session jsonb plus tenant/restaurant fields", async () => {
    const { rpc, calls } = rpcReturning({ data: okPayload, error: null });
    expect(await crewClaimShiftCore(input, rpc)).toEqual({
      ok: true,
      sessionId: "session-1",
      role: "kasir",
      displayName: "Budi",
      checkedInAt: "2026-09-13T09:00:00.000Z",
      sessionToken: "opaque-session-token",
      tenantToken: "opaque-tenant-token",
      restaurantId: RESTAURANT_ID,
      restaurantName: "RM Sederhana",
      restaurantCode: "RMSED01",
    });
    expect(calls[0]).toEqual({
      fn: "crew_shift_claim",
      params: {
        p_role: "kasir",
        p_checked_in_at: input.checkedInAt,
        p_device_token: input.deviceToken,
      },
    });
  });

  it("maps every raised claim verdict", async () => {
    for (const code of [
      "NOT_PAIRED",
      "ACCOUNT_DISABLED",
      "INVALID_DEVICE",
      "INVALID_ROLE",
      "INVALID_CHECKED_IN_AT",
      "UNAUTHORIZED",
    ] as const) {
      const { rpc } = rpcThrowing(code);
      expect(await crewClaimShiftCore(input, rpc)).toMatchObject({ ok: false, code });
    }
  });

  it("returns UNAVAILABLE for malformed payloads without leaking raw errors", async () => {
    const { rpc } = rpcReturning({ data: { session: {} }, error: null });
    expect(await crewClaimShiftCore(input, rpc)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    const leaky = rpcThrowing('invalid input syntax for type uuid: "zz"');
    expect(await crewClaimShiftCore(input, leaky.rpc)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(JSON.stringify(await crewClaimShiftCore(input, leaky.rpc))).not.toContain(
      "invalid input",
    );
  });
});

describe("crewPairingListCore (manager)", () => {
  it("decrypts each otp_encrypted envelope into a displayable otp", async () => {
    const { rpc, calls } = rpcReturning({
      data: [
        {
          id: REQUEST_ID,
          email: "budi@example.com",
          full_name: "Budi",
          otp_encrypted: encryptEnvelopeHex("123456", KEY),
          created_at: "2026-09-13T09:00:00.000Z",
          expires_at: "2026-09-13T09:15:00.000Z",
        },
      ],
      error: null,
    });
    const result = await crewPairingListCore({ managerToken: "mgr-token" }, rpc);
    expect(calls[0]).toEqual({
      fn: "get_crew_pairing_requests",
      params: { p_manager_token: "mgr-token" },
    });
    expect(result).toEqual({
      ok: true,
      requests: [
        {
          id: REQUEST_ID,
          email: "budi@example.com",
          fullName: "Budi",
          otp: "123456",
          createdAt: "2026-09-13T09:00:00.000Z",
          expiresAt: "2026-09-13T09:15:00.000Z",
        },
      ],
    });
  });

  it("never returns partial rows: one undecryptable envelope fails the whole list", async () => {
    const { rpc } = rpcReturning({
      data: [
        {
          id: REQUEST_ID,
          email: "a@example.com",
          full_name: "A",
          otp_encrypted: encryptEnvelopeHex("123456", KEY),
          created_at: "x",
          expires_at: "y",
        },
        {
          id: REQUEST_ID,
          email: "b@example.com",
          full_name: "B",
          otp_encrypted: "4c494d4551523031deadbeef",
          created_at: "x",
          expires_at: "y",
        },
      ],
      error: null,
    });
    expect(await crewPairingListCore({ managerToken: "t" }, rpc)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
  });

  it("maps INVALID_SESSION and malformed data", async () => {
    const { rpc } = rpcThrowing("INVALID_SESSION");
    expect(await crewPairingListCore({ managerToken: "t" }, rpc)).toMatchObject({
      ok: false,
      code: "INVALID_SESSION",
    });
    const malformed = rpcReturning({ data: { not: "array" }, error: null });
    expect(await crewPairingListCore({ managerToken: "t" }, malformed.rpc)).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});

describe("crew manager mutations", () => {
  it("crewPairingRejectCore maps ok / NOT_FOUND verdict / INVALID_SESSION raise", async () => {
    const ok = rpcReturning({ data: { ok: true }, error: null });
    expect(
      await crewPairingRejectCore({ managerToken: "t", requestId: REQUEST_ID }, ok.rpc),
    ).toEqual({ ok: true });
    const notFound = rpcReturning({ data: { ok: false, error: "NOT_FOUND" }, error: null });
    expect(
      await crewPairingRejectCore({ managerToken: "t", requestId: REQUEST_ID }, notFound.rpc),
    ).toMatchObject({ ok: false, code: "NOT_FOUND" });
    const invalid = rpcThrowing("INVALID_SESSION");
    expect(
      await crewPairingRejectCore({ managerToken: "t", requestId: REQUEST_ID }, invalid.rpc),
    ).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("crewAccountListCore normalizes roster rows", async () => {
    const { rpc, calls } = rpcReturning({
      data: [
        {
          auth_uid: AUTH_UID,
          email: "budi@example.com",
          full_name: "Budi",
          status: "aktif",
          paired_at: "2026-09-13T08:00:00.000Z",
          has_active_device: true,
          active_sessions: 2,
        },
      ],
      error: null,
    });
    expect(await crewAccountListCore({ managerToken: "t" }, rpc)).toEqual({
      ok: true,
      accounts: [
        {
          authUid: AUTH_UID,
          email: "budi@example.com",
          fullName: "Budi",
          status: "aktif",
          pairedAt: "2026-09-13T08:00:00.000Z",
          hasActiveDevice: true,
          activeSessions: 2,
        },
      ],
    });
    expect(calls[0]).toEqual({ fn: "get_crew_accounts", params: { p_manager_token: "t" } });
  });

  it("crewAccountResetCore and crewSessionsEndCore map verdicts and raises", async () => {
    for (const core of [crewAccountResetCore, crewSessionsEndCore]) {
      const ok = rpcReturning({ data: { ok: true }, error: null });
      expect(await core({ managerToken: "t", authUid: AUTH_UID }, ok.rpc)).toEqual({ ok: true });
      const notFound = rpcReturning({ data: { ok: false, error: "NOT_FOUND" }, error: null });
      expect(await core({ managerToken: "t", authUid: AUTH_UID }, notFound.rpc)).toMatchObject({
        ok: false,
        code: "NOT_FOUND",
      });
      const invalid = rpcThrowing("INVALID_SESSION");
      expect(await core({ managerToken: "t", authUid: AUTH_UID }, invalid.rpc)).toMatchObject({
        ok: false,
        code: "INVALID_SESSION",
      });
    }
    const reset = rpcReturning({ data: { ok: true }, error: null });
    await crewAccountResetCore({ managerToken: "t", authUid: AUTH_UID }, reset.rpc);
    expect(reset.calls[0].fn).toBe("reset_crew_account");
    expect(reset.calls[0].params).toEqual({ p_manager_token: "t", p_auth_uid: AUTH_UID });
    const end = rpcReturning({ data: { ok: true }, error: null });
    await crewSessionsEndCore({ managerToken: "t", authUid: AUTH_UID }, end.rpc);
    expect(end.calls[0].fn).toBe("end_active_crew_sessions");
  });
});

describe("crew-auth input validators", () => {
  it("crewValidateCodeInputSchema requires accessToken and non-empty code", () => {
    expect(
      crewValidateCodeInputSchema.safeParse({ accessToken: "jwt", code: "RM01" }).success,
    ).toBe(true);
    expect(crewValidateCodeInputSchema.safeParse({ accessToken: "", code: "RM01" }).success).toBe(
      false,
    );
    expect(crewValidateCodeInputSchema.safeParse({ accessToken: "jwt", code: "  " }).success).toBe(
      false,
    );
  });

  it("crewRequestPairingInputSchema requires a uuid restaurantId and bounded fullName", () => {
    expect(
      crewRequestPairingInputSchema.safeParse({
        accessToken: "jwt",
        restaurantId: RESTAURANT_ID,
        fullName: "Budi",
      }).success,
    ).toBe(true);
    expect(
      crewRequestPairingInputSchema.safeParse({
        accessToken: "jwt",
        restaurantId: "not-a-uuid",
        fullName: "Budi",
      }).success,
    ).toBe(false);
    expect(
      crewRequestPairingInputSchema.safeParse({
        accessToken: "jwt",
        restaurantId: RESTAURANT_ID,
        fullName: "x".repeat(41),
      }).success,
    ).toBe(false);
  });

  it("crewConfirmPairingInputSchema requires uuid requestId and exactly-6-digit otp", () => {
    expect(
      crewConfirmPairingInputSchema.safeParse({
        accessToken: "jwt",
        requestId: REQUEST_ID,
        otp: "123456",
      }).success,
    ).toBe(true);
    expect(
      crewConfirmPairingInputSchema.safeParse({
        accessToken: "jwt",
        requestId: "nope",
        otp: "123456",
      }).success,
    ).toBe(false);
    expect(
      crewConfirmPairingInputSchema.safeParse({
        accessToken: "jwt",
        requestId: REQUEST_ID,
        otp: "12ab34",
      }).success,
    ).toBe(false);
    expect(
      crewConfirmPairingInputSchema.safeParse({
        accessToken: "jwt",
        requestId: REQUEST_ID,
        otp: "12345",
      }).success,
    ).toBe(false);
  });

  it("crewClaimShiftInputSchema enforces role enum, iso checkedInAt, deviceToken min 16", () => {
    const base = {
      accessToken: "jwt",
      role: "kasir",
      checkedInAt: "2026-09-13T09:00:00.000Z",
      deviceToken: "d".repeat(32),
    };
    expect(crewClaimShiftInputSchema.safeParse(base).success).toBe(true);
    expect(crewClaimShiftInputSchema.safeParse({ ...base, role: "chef" }).success).toBe(false);
    expect(crewClaimShiftInputSchema.safeParse({ ...base, deviceToken: "short" }).success).toBe(
      false,
    );
    expect(
      crewClaimShiftInputSchema.safeParse({ ...base, checkedInAt: "not-an-iso-date" }).success,
    ).toBe(false);
    expect(crewClaimShiftInputSchema.safeParse({ ...base, accessToken: "" }).success).toBe(false);
  });
});

describe("crew-auth.server.ts source contract", () => {
  it("routes every call through the anon-authed client, never the service role", () => {
    const text = source();
    expect(text).toContain("getAnonAuthedSupabaseClient");
    expect(text).toContain('createServerFn({ method: "POST" })');
    expect(text).not.toContain("getServiceClient");
  });
});
