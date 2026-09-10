// Rond 6 review fixes (RED first). Covers the gaps found by the independent
// pre-ship review:
//   1. Surrendered-token cleanup tolerance: a client-surrendered bearer whose
//      row was purged WITHOUT a tombstone (newest-wins supersede, account-wide
//      revoke, cutover delete) comes back as UNKNOWN_TOKEN and must not
//      brick logout or the next login for that browser.
//   2. Owner-limiter TS adapter verdict mapping (TIMEOUT / MALFORMED /
//      UNKNOWN_RESERVATION / reserve shapes) — behavior tests, not regex.
//   3. managerExtras lookup must be case-insensitive (legacy mixed-case
//      manager ids) with LIKE-wildcards escaped.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  revokeManagerSessionByTokenIfLive,
  revokeStaffSessionByTokenIfLive,
  revokeStaffSessionByToken,
  revokeManagerSessionByToken,
} from "../src/lib/auth.server";
import {
  completeOwnerLoginAttempt,
  reserveOwnerLoginAttempt,
} from "../src/lib/owner-login-rate-limit.server";
import { managerPasswordChangedAt } from "../src/lib/staff-login.server";
import { superAdminLoginCore, type SuperAdminLoginDeps } from "../src/lib/auth";

const state = vi.hoisted(() => ({ client: undefined as unknown }));

vi.mock("../src/lib/remote-audio.server", () => ({
  getServiceClient: () => state.client,
}));

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => ({ headers: new Headers() }),
}));

function rpcClient(handler: (fn: string, params: Record<string, unknown>) => unknown) {
  return { rpc: async (fn: string, params: Record<string, unknown>) => handler(fn, params) };
}

beforeEach(() => {
  state.client = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("surrendered-token cleanup: UNKNOWN_TOKEN tolerance is opt-in", () => {
  const junk = (fn: string) =>
    fn === "revoke_manager_session_by_token" || fn === "revoke_staff_session_by_token"
      ? { data: { verdict: "UNKNOWN_TOKEN" }, error: null }
      : { data: null, error: null };

  it("default stays fail-closed: UNKNOWN_TOKEN throws (junk never counts as inactive)", async () => {
    state.client = rpcClient(junk);
    await expect(revokeManagerSessionByTokenIfLive("tok")).rejects.toThrow("UNKNOWN_TOKEN");
    await expect(revokeStaffSessionByTokenIfLive("area_manager", "tok")).rejects.toThrow(
      "UNKNOWN_TOKEN",
    );
    await expect(revokeManagerSessionByToken("tok")).rejects.toThrow("UNKNOWN_TOKEN");
    await expect(revokeStaffSessionByToken("area_manager", "tok")).rejects.toThrow("UNKNOWN_TOKEN");
  });

  it("tolerateUnknown treats UNKNOWN_TOKEN as done (token is provably not live)", async () => {
    state.client = rpcClient(junk);
    await expect(
      revokeManagerSessionByTokenIfLive("tok", { tolerateUnknown: true }),
    ).resolves.toBeUndefined();
    await expect(
      revokeStaffSessionByTokenIfLive("super_admin", "tok", { tolerateUnknown: true }),
    ).resolves.toBeUndefined();
    await expect(
      revokeManagerSessionByToken("tok", { tolerateUnknown: true }),
    ).resolves.toBeUndefined();
    await expect(
      revokeStaffSessionByToken("area_manager", "tok", { tolerateUnknown: true }),
    ).resolves.toBeUndefined();
  });

  it("tolerateUnknown never forgives KIND_MISMATCH or malformed payloads", async () => {
    state.client = rpcClient((fn) =>
      fn === "revoke_staff_session_by_token"
        ? { data: { verdict: "KIND_MISMATCH" }, error: null }
        : { data: { nope: true }, error: null },
    );
    await expect(
      revokeStaffSessionByTokenIfLive("area_manager", "tok", { tolerateUnknown: true }),
    ).rejects.toThrow("KIND_MISMATCH");
    await expect(
      revokeManagerSessionByTokenIfLive("tok", { tolerateUnknown: true }),
    ).rejects.toThrow("REVOKE_MALFORMED");
  });

  it("REVOKED and ALREADY_INACTIVE still resolve with tolerance on", async () => {
    let verdict = "REVOKED";
    state.client = rpcClient((fn) =>
      fn === "revoke_manager_session_by_token"
        ? { data: { verdict }, error: null }
        : { data: null, error: null },
    );
    await expect(
      revokeManagerSessionByTokenIfLive("tok", { tolerateUnknown: true }),
    ).resolves.toBeUndefined();
    verdict = "ALREADY_INACTIVE";
    await expect(
      revokeManagerSessionByTokenIfLive("tok", { tolerateUnknown: true }),
    ).resolves.toBeUndefined();
  });

  it("transport failure still throws with tolerance on", async () => {
    state.client = rpcClient(() => ({ data: null, error: { message: "boom" } }));
    await expect(
      revokeManagerSessionByTokenIfLive("tok", { tolerateUnknown: true }),
    ).rejects.toThrow("REVOKE_FAILED");
  });
});

describe("owner-limiter TS adapter verdict mapping", () => {
  it("reserve: single-row table shape yields the reservation id", async () => {
    state.client = rpcClient(() => ({ data: [{ reservation_id: "res-1" }], error: null }));
    await expect(reserveOwnerLoginAttempt("ck", "ak")).resolves.toBe("res-1");
  });

  it("reserve: empty table (blocked bucket) -> null, never a crash", async () => {
    state.client = rpcClient(() => ({ data: [], error: null }));
    await expect(reserveOwnerLoginAttempt("ck")).resolves.toBeNull();
  });

  it("reserve: malformed payload -> null", async () => {
    state.client = rpcClient(() => ({ data: { reservation_id: "nope" }, error: null }));
    await expect(reserveOwnerLoginAttempt("ck")).resolves.toBeNull();
  });

  it("complete: known verdicts pass through unchanged", async () => {
    state.client = rpcClient(() => ({ data: "ALREADY_FAILED", error: null }));
    await expect(completeOwnerLoginAttempt("res", false)).resolves.toBe("ALREADY_FAILED");
  });

  it("complete: unrecognized payload -> MALFORMED (never a silent success)", async () => {
    state.client = rpcClient(() => ({ data: { verdict: "SUCCEEDED" }, error: null }));
    await expect(completeOwnerLoginAttempt("res", true)).resolves.toBe("MALFORMED");
  });

  it("complete: rpc error and missing client -> UNKNOWN_RESERVATION", async () => {
    state.client = rpcClient(() => ({ data: null, error: { message: "boom" } }));
    await expect(completeOwnerLoginAttempt("res", true)).resolves.toBe("UNKNOWN_RESERVATION");
    state.client = null;
    await expect(completeOwnerLoginAttempt("res", true)).resolves.toBe("UNKNOWN_RESERVATION");
  });

  it("complete: hung limiter is bounded -> TIMEOUT", async () => {
    vi.useFakeTimers();
    state.client = rpcClient(() => new Promise(() => undefined));
    const pending = completeOwnerLoginAttempt("res", true);
    const assertion = expect(pending).resolves.toBe("TIMEOUT");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});

describe("SA login surrendered-token cleanup passes tolerance", () => {
  function saDeps(revokes: {
    staff: Array<{ kind: string; token: string; opts: unknown }>;
    manager: Array<{ token: string; opts: unknown }>;
  }) {
    return {
      rpc: (async (fn: string) =>
        fn === "bootstrap_super_admin_state"
          ? { data: { open: true, active_count: 0 }, error: null }
          : { data: null, error: null }) as SuperAdminLoginDeps["rpc"],
      report: async () => true,
      verify: async () => true,
      updateSession: async () => undefined,
      legacyPassword: "pw",
      cookieStaffTokens: async () => ({
        superAdminToken: "cookie-sa",
        areaManagerToken: "cookie-am",
      }),
      revokeStaffSessionByToken: (async (
        kind: string,
        token: string,
        opts: unknown,
      ) => revokes.staff.push({ kind, token, opts })) as SuperAdminLoginDeps["revokeStaffSessionByToken"],
      revokeManagerSessionByToken: (async (token: string, opts: unknown) =>
        revokes.manager.push({ token, opts })) as SuperAdminLoginDeps["revokeManagerSessionByToken"],
      managerTokenToRevoke: "surrendered-mgr",
    } satisfies SuperAdminLoginDeps;
  }

  it("legacy SA login: every surrendered token revocation passes tolerateUnknown", async () => {
    const revokes = { staff: [], manager: [] } as {
      staff: Array<{ kind: string; token: string; opts: unknown }>;
      manager: Array<{ token: string; opts: unknown }>;
    };
    const result = await superAdminLoginCore(
      { mode: "legacy", password: "pw" },
      saDeps(revokes),
    );
    expect(result).toEqual({ ok: true });
    expect(revokes.staff).toEqual([
      { kind: "super_admin", token: "cookie-sa", opts: { tolerateUnknown: true } },
      { kind: "area_manager", token: "cookie-am", opts: { tolerateUnknown: true } },
    ]);
    expect(revokes.manager).toEqual([
      { token: "surrendered-mgr", opts: { tolerateUnknown: true } },
    ]);
  });

  it("individual SA login: surrendered revocations tolerate unknown; just-minted compensation stays strict", async () => {
    const revokes = { staff: [], manager: [] } as unknown as {
      staff: Array<{ kind: string; token: string; opts: unknown }>;
      manager: Array<{ token: string; opts: unknown }>;
    };
    const deps = {
      ...saDeps(revokes),
      rpc: (async (fn: string, params: Record<string, unknown>) =>
        fn === "get_super_admin_credential"
          ? {
              data: { id: "sa-1", password_hash: "x:y", status: "aktif" },
              error: null,
            }
          : fn === "create_staff_session"
            ? { data: "minted-sa-token", error: null }
            : { data: null, error: null }) as SuperAdminLoginDeps["rpc"],
      cookieStaffTokens: async () => ({ superAdminToken: null, areaManagerToken: "cookie-am" }),
    } satisfies SuperAdminLoginDeps;
    const result = await superAdminLoginCore(
      { mode: "individual", staffId: "sa.budi", password: "pw" },
      deps,
    );
    expect(result).toEqual({ ok: true });
    expect(revokes.staff).toEqual([
      { kind: "area_manager", token: "cookie-am", opts: { tolerateUnknown: true } },
    ]);
    expect(revokes.manager).toEqual([
      { token: "surrendered-mgr", opts: { tolerateUnknown: true } },
    ]);
  });
});

describe("managerExtras: case-insensitive legacy id lookup", () => {
  function stubClient(row: Record<string, unknown> | null, capture: { pattern?: string } = {}) {
    const chain = {
      select: () => chain,
      ilike: (_col: string, pattern: string) => {
        capture.pattern = pattern;
        return chain;
      },
      single: async () => ({ data: row, error: row ? null : { message: "no rows" } }),
    };
    return { from: () => chain };
  }

  it("mixed-case legacy manager id is found case-insensitively", async () => {
    const capture: { pattern?: string } = {};
    const result = await managerPasswordChangedAt(
      stubClient({ id: "m1", password_changed_at: null }, capture),
      "aguskasir",
    );
    expect(result).toEqual({ id: "m1", password_changed_at: null }); // null -> remind
    expect(capture.pattern).toBe("aguskasir");
  });

  it("LIKE wildcards in the id are escaped (literal match)", async () => {
    const capture: { pattern?: string } = {};
    await managerPasswordChangedAt(
      stubClient({ id: "m1", password_changed_at: "set" }, capture),
      "pe%d_kasir",
    );
    expect(capture.pattern).toBe("pe\\%d\\_kasir");
  });

  it("PostgREST glob metas (dot, star) are escaped too - real ids are dotted", async () => {
    const capture: { pattern?: string } = {};
    await managerPasswordChangedAt(
      stubClient({ id: "m1", password_changed_at: "set" }, capture),
      "budi.santoso",
    );
    expect(capture.pattern).toBe("budi\\.santoso");
    await managerPasswordChangedAt(
      stubClient({ id: "m1", password_changed_at: "set" }, capture),
      "man*ger",
    );
    expect(capture.pattern).toBe("man\\*ger");
  });

  it("found row with password_changed_at set -> no reminder", async () => {
    const result = await managerPasswordChangedAt(
      stubClient({ id: "m1", password_changed_at: "2026-01-01T00:00:00Z" }),
      "agus.kasir",
    );
    expect(result).toEqual({ id: "m1", password_changed_at: "2026-01-01T00:00:00Z" });
  });
});
