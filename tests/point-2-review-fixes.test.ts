// Executable behaviour proofs for the Poin 2 review fixes at the Node layer
// (the DB integration suite proves the RPC side). These exercise the extracted
// *Core functions with injected fake email/rpc/report deps — real logic, no
// regex-over-source assertions.
import { describe, expect, it, vi } from "vitest";
import {
  bootstrapCreateSuperAdminCore,
  inviteSuperAdminCore,
  resendSuperAdminInviteCore,
  requestSuperAdminRecoveryCore,
  sha256Hex,
} from "../src/lib/super-admin-auth.server";
import { loginStaffCore } from "../src/lib/staff-login.server";
import {
  submitResetRequestAttemptCore,
  submitResetRequestCore,
} from "../src/lib/staff-password-reset.server";
import { superAdminReauthCore } from "../src/lib/auth.server";
import { computeAuthStatus } from "../src/lib/auth";
import { generateStaffToken } from "../src/lib/staff-identity.server";

describe("bootstrap / invite / resend: email-first, sha256(raw) persisted", () => {
  it("persists sha256 of the RAW emailed token (not a :verify variant)", async () => {
    let emailed = "";
    let persistedHash = "";
    const result = await bootstrapCreateSuperAdminCore(
      { staffId: "sa.satu", fullName: "SA Satu", email: "sa@x.test" },
      {
        linkFor: (staffId, raw) => {
          emailed = raw;
          return `https://app.test/super-admin/accept?staff_id=${staffId}&token=${raw}`;
        },
        sendEmail: async () => ({ ok: true }),
        rpc: async (_fn, params) => {
          persistedHash = String(params.p_verify_token_hash);
          return { data: { ok: true, id: "acc-1" }, error: null };
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(emailed.length).toBeGreaterThanOrEqual(43); // base64url 32 bytes
    expect(persistedHash).toBe(sha256Hex(emailed));
    expect(persistedHash).not.toContain("verify");
  });

  it("email failure aborts BEFORE any account/token is persisted (fail-closed)", async () => {
    let rpcCalled = false;
    const result = await bootstrapCreateSuperAdminCore(
      { staffId: "sa.dua", fullName: "SA Dua", email: "sa@x.test" },
      {
        linkFor: () => "https://app.test/x",
        sendEmail: async () => ({ ok: false, code: "EMAIL_UNAVAILABLE" }),
        rpc: async () => {
          rpcCalled = true;
          return { data: "nope", error: null };
        },
      },
    );
    expect(result).toEqual({ ok: false, code: "EMAIL_UNAVAILABLE" });
    expect(rpcCalled).toBe(false);
  });

  it("resend emails a fresh raw token before re-persisting its sha256", async () => {
    let emailed = "";
    let resendRpcHash = "";
    const result = await resendSuperAdminInviteCore(
      { superAdminId: "acc-1", staffId: "sa.tiga", email: "sa3@x.test", actorId: "actor-1" },
      {
        linkFor: (_s, raw) => {
          emailed = raw;
          return `https://app.test/a?token=${raw}`;
        },
        sendEmail: async () => ({ ok: true }),
        rpc: async (_fn, params) => {
          resendRpcHash = String(params.p_new_token_hash);
          return { data: { ok: true }, error: null };
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(resendRpcHash).toBe(sha256Hex(emailed));
  });

  it("invite persists only after the email carrying the raw token succeeds", async () => {
    const order: string[] = [];
    await inviteSuperAdminCore(
      { staffId: "sa.empat", fullName: "SA Empat", email: "sa4@x.test", creatorId: "c" },
      {
        linkFor: () => "https://app.test/a",
        sendEmail: async () => {
          order.push("email");
          return { ok: true };
        },
        rpc: async () => {
          order.push("rpc");
          return { data: { ok: true, id: "acc" }, error: null };
        },
      },
    );
    expect(order).toEqual(["email", "rpc"]);
  });
});

describe("recovery: no live token unless email delivered", () => {
  it("unknown account never creates a token and reports failure", async () => {
    let tokenCreated = false;
    const delivered = await requestSuperAdminRecoveryCore("ghost@x.test", {
      rpc: async () => {
        tokenCreated = true;
        return { data: null, error: null };
      },
      sendEmail: async () => ({ ok: true }),
      linkFor: () => "https://app.test/r",
      transportConfigured: () => true,
      lookupAccount: async () => null,
    });
    expect(delivered).toBe(false);
    expect(tokenCreated).toBe(false);
  });

  it("provider failure leaves NO recovery token row written", async () => {
    let tokenCreated = false;
    const delivered = await requestSuperAdminRecoveryCore("sa@x.test", {
      rpc: async () => {
        tokenCreated = true;
        return { data: null, error: null };
      },
      sendEmail: async () => ({ ok: false, code: "EMAIL_SEND_FAILED" }),
      linkFor: () => "https://app.test/r",
      transportConfigured: () => true,
      lookupAccount: async () => ({ id: "acc", staffId: "sa" }),
    });
    expect(delivered).toBe(false);
    expect(tokenCreated).toBe(false);
  });

  it("happy path persists sha256(raw) after the email", async () => {
    let emailed = "";
    let hash = "";
    const delivered = await requestSuperAdminRecoveryCore("sa@x.test", {
      rpc: async (_fn, params) => {
        hash = String(params.p_token_hash);
        return { data: { ok: true }, error: null };
      },
      sendEmail: async () => ({ ok: true }),
      linkFor: (_s, raw) => {
        emailed = raw;
        return `https://app.test/r?token=${raw}`;
      },
      transportConfigured: () => true,
      lookupAccount: async () => ({ id: "acc", staffId: "sa" }),
    });
    expect(delivered).toBe(true);
    expect(hash).toBe(sha256Hex(emailed));
  });
});

describe("staff login: rate-limit accounting is exact (B12)", () => {
  const okManagerCred = {
    id: "m1",
    password_hash: "salt:hash",
    status: "aktif",
    full_name: "M",
    restaurant_id: "r1",
    restaurant_display_name: "Resto",
    restaurant_code: "R1",
  };
  it("counts a wrong manager password as a failure, not success", async () => {
    let reported: boolean | null = null;
    const r = await loginStaffCore("mgr", "bad", {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? { data: okManagerCred, error: null }
          : { data: null, error: { message: "x" } },
      verify: async () => false,
      report: async (v) => {
        reported = v;
        return "FAILED";
      },
    });
    expect(r.ok).toBe(false);
    expect(reported).toBe(false);
  });
  it("a manager whose session mint fails is NOT counted as success", async () => {
    let reported: boolean | null = null;
    const r = await loginStaffCore("mgr", "pw", {
      rpc: async (fn) => {
        if (fn === "get_manager_credential") return { data: okManagerCred, error: null };
        if (fn === "create_manager_session_pending")
          return { data: null, error: { message: "boom" } };
        return { data: null, error: null };
      },
      verify: async () => true,
      report: async (v) => {
        reported = v;
        return "FAILED";
      },
    });
    expect(r.ok).toBe(false);
    expect(reported).toBe(false);
  });
  it("a disabled manager is denied with the generic message (no oracle)", async () => {
    let reported: boolean | null = null;
    const r = await loginStaffCore("mgr", "pw", {
      rpc: async (fn) =>
        fn === "get_manager_credential"
          ? { data: { ...okManagerCred, status: "nonaktif" }, error: null }
          : { data: null, error: { message: "no am" } },
      verify: async () => true,
      report: async (v) => {
        reported = v;
        return "FAILED";
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Login gagal. Periksa kembali ID dan password.");
    expect(reported).toBe(false);
  });
});

describe("reset request accounting (B12)", () => {
  const reservationId = "11111111-1111-4111-8111-111111111111";
  const strongInput = {
    staffId: "mgr",
    newPassword: "abcdefghijkl",
    rateLimitReservationId: reservationId,
  };

  it("forwards the limiter reservation into the reset mutation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await submitResetRequestCore("submit_manager_reset_request", strongInput, {
      rpc,
      completeFailed: vi.fn(),
    });
    expect(rpc).toHaveBeenCalledWith(
      "submit_manager_reset_request",
      expect.objectContaining({ p_reservation_id: reservationId }),
    );
  });

  it("never performs a separate completion after a valid-password DB submit", async () => {
    const cases = [
      { data: true, error: null },
      { data: false, error: null },
      { data: null, error: { message: "database rejection" } },
    ];
    for (const response of cases) {
      const completeFailed = vi.fn();
      await submitResetRequestCore("submit_manager_reset_request", strongInput, {
        rpc: async () => response,
        completeFailed,
      });
      expect(completeFailed).not.toHaveBeenCalled();
    }
  });

  it("does not contradict an uncertain DB transaction with a separate completion", async () => {
    const completeFailed = vi.fn();
    await expect(
      submitResetRequestCore("submit_manager_reset_request", strongInput, {
        rpc: async () => {
          throw new Error("response unavailable");
        },
        completeFailed,
      }),
    ).rejects.toThrow("response unavailable");
    expect(completeFailed).not.toHaveBeenCalled();
  });

  it("reconciles an already-terminal attempt when reserve returns no live reservation", async () => {
    const submit = vi.fn();
    const result = await submitResetRequestAttemptCore(
      "manager",
      {
        staffId: "mgr",
        newPassword: "abcdefghijkl",
        clientKey: "client-key-long-enough",
        attemptKey: "attempt-key-long-enough",
      },
      {
        reserve: async () => null,
        reconcile: async () => "SUCCEEDED",
        submit,
      },
    );
    expect(result).toEqual({ ok: true });
    expect(submit).not.toHaveBeenCalled();
  });

  it("reconciles after the reset submit transport becomes uncertain", async () => {
    const reconcile = vi.fn().mockResolvedValue("FAILED");
    const result = await submitResetRequestAttemptCore(
      "area_manager",
      {
        staffId: "am",
        newPassword: "abcdefghijkl",
        clientKey: "client-key-long-enough",
        attemptKey: "transport-uncertain-attempt",
      },
      {
        reserve: async () => reservationId,
        reconcile,
        submit: async () => {
          throw new Error("response unavailable");
        },
      },
    );
    expect(result).toEqual({ ok: true });
    expect(reconcile).toHaveBeenCalledWith("transport-uncertain-attempt", "area_manager");
  });

  it("reuses a live reservation for the reset mutation", async () => {
    const submit = vi.fn().mockResolvedValue({ ok: true });
    const result = await submitResetRequestAttemptCore(
      "area_manager",
      {
        staffId: "am",
        newPassword: "abcdefghijkl",
        clientKey: "client-key-long-enough",
        attemptKey: "attempt-key-long-enough",
      },
      {
        reserve: async () => reservationId,
        reconcile: async () => "UNKNOWN",
        submit,
      },
    );
    expect(result).toEqual({ ok: true });
    expect(submit).toHaveBeenCalledWith(reservationId);
  });

  it("fails closed when a dead attempt has no authoritative reset result", async () => {
    const result = await submitResetRequestAttemptCore(
      "manager",
      {
        staffId: "mgr",
        newPassword: "abcdefghijkl",
        clientKey: "client-key-long-enough",
        attemptKey: "attempt-key-long-enough",
      },
      {
        reserve: async () => null,
        reconcile: async () => "UNKNOWN",
        submit: async () => ({ ok: true }),
      },
    );
    expect(result).toEqual({ ok: false, message: GENERIC_AUTH_FAILURE });
  });

  it("weak password completes the reservation as failed and never reaches the reset RPC", async () => {
    const completeFailed = vi.fn().mockResolvedValue("FAILED");
    const rpc = vi.fn();
    const result = await submitResetRequestCore(
      "submit_am_reset_request",
      {
        staffId: "am",
        newPassword: "short",
        rateLimitReservationId: reservationId,
      },
      { rpc, completeFailed },
    );
    expect(result).toEqual({ ok: false, message: GENERIC_AUTH_FAILURE });
    expect(completeFailed).toHaveBeenCalledWith(reservationId);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("reauthentication binds to the individual account (B13)", () => {
  it("individual session verifies against the account hash, never the env password", async () => {
    const verify = async (pw: string, stored: string) => stored === `hash(${pw})`;
    expect(
      await superAdminReauthCore(
        "right",
        "individual",
        { individualHash: "hash(right)", legacyPassword: "legacy" },
        verify,
      ),
    ).toBe(true);
    // Legacy password being correct must NOT authorize an individual session.
    expect(
      await superAdminReauthCore(
        "legacy",
        "individual",
        { individualHash: "hash(right)", legacyPassword: "legacy" },
        verify,
      ),
    ).toBe(false);
    expect(
      await superAdminReauthCore(
        "x",
        "individual",
        { individualHash: null, legacyPassword: "legacy" },
        verify,
      ),
    ).toBe(false);
  });
  it("legacy mode only checks the shared password", async () => {
    const real = await superAdminReauthCore(
      "anything",
      "legacy",
      { individualHash: null, legacyPassword: null },
      async () => true,
    );
    expect(real).toBe(false); // null env password -> fail closed
  });
});

describe("getAuthStatus is DB-authoritative (C21)", () => {
  it("logged-out when the authoritative gate rejects the session", async () => {
    expect(
      await computeAuthStatus(async () => {
        throw new Error("UNAUTHORIZED");
      }),
    ).toEqual({ superAdmin: false });
  });
  it("logged-in only when the gate accepts", async () => {
    expect(await computeAuthStatus(async () => ({}))).toEqual({ superAdmin: true });
  });
});

describe("tokens are CSPRNG and high entropy (B6)", () => {
  it("generates distinct 256-bit base64url values", () => {
    const a = generateStaffToken();
    const b = generateStaffToken();
    expect(a).not.toBe(b);
    expect(/^[A-Za-z0-9_-]{43}$/.test(a)).toBe(true);
  });
});
