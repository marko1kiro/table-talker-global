import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GENERIC_AUTH_FAILURE } from "./staff-identity.server";
import type { TableTalkerSession } from "./auth.server";

export type AuthStatus = { superAdmin: boolean };

/**
 * Authoritative status (review C21): the UI is only told "Super Admin" when
 * requireSuperAdmin — the same DB-backed gate that protects every privileged
 * action — accepts the current session. A legacy cookie after the bootstrap
 * cutover, or an individual session whose bearer token was revoked (password
 * change / deactivation), reports logged-out exactly like the server behaves.
 */
export async function computeAuthStatus(authorize: () => Promise<unknown>): Promise<AuthStatus> {
  try {
    await authorize();
    return { superAdmin: true };
  } catch {
    return { superAdmin: false };
  }
}

export const loginInputSchema = z.object({
  mode: z.enum(["legacy", "individual"]),
  staffId: z.string().optional(),
  password: z.string(),
  clientKey: z.string().min(16).max(200),
  attemptKey: z.string().min(16).max(200),
  // R3-A: the OLD manager bearer token surrendered on a Manager -> SA switch.
  managerToken: z.string().min(1).max(200).optional(),
});

export function ownerLoginFailure() {
  return { ok: false as const, message: GENERIC_AUTH_FAILURE };
}

/**
 * Kredensial HANYA datang dari environment / database. Tidak ada fallback
 * hardcoded: kalau env belum diset, login ditolak (fail closed).
 */
function readEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    console.error(`[auth] Environment variable ${name} belum diset — login ditolak.`);
    return null;
  }
  return value;
}

export const getAuthStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthStatus> => {
    const { requireSuperAdmin } = await import("./auth.server");
    return computeAuthStatus(() => requireSuperAdmin());
  },
);

async function withLoginRateLimit<T>(
  clientKey: string,
  attemptKey: string,
  action: (report: (valid: boolean) => Promise<boolean>) => Promise<T>,
  onFailure: () => T,
): Promise<T> {
  const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
    await import("./owner-login-rate-limit.server");
  const reservationId = await reserveOwnerLoginAttempt(clientKey, attemptKey);
  if (!reservationId) return onFailure();
  const report = async (valid: boolean) => {
    const verdict = await completeOwnerLoginAttempt(reservationId, valid);
    return verdict === "SUCCEEDED" || verdict === "ALREADY_SUCCEEDED";
  };
  try {
    return await action(report);
  } catch {
    return onFailure();
  }
}

type LoginRpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** Constant-time shared-secret comparison (no node:crypto — client-safe module). */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SuperAdminLoginDeps = {
  rpc: LoginRpcCaller;
  report: (valid: boolean) => Promise<unknown>;
  verify: (password: string, stored: string) => Promise<boolean>;
  updateSession: (update: Partial<TableTalkerSession>) => Promise<unknown>;
  legacyPassword: string;
  /** R3-A: bearer tokens currently held by this browser's session cookie. */
  cookieStaffTokens?: () => Promise<{
    superAdminToken: string | null;
    areaManagerToken: string | null;
  }>;
  /** R3-A: server-side revocation of one staff/manager bearer session.
   * Role-switch handoff is mandatory: UNKNOWN_TOKEN must throw and prevent
   * replacement credential minting. Optional logout cleanup is elsewhere. */
  revokeStaffSessionByToken?: (
    kind: "super_admin" | "area_manager",
    token: string,
    opts?: { tolerateUnknown?: boolean },
  ) => Promise<void>;
  revokeManagerSessionByToken?: (
    token: string,
    opts?: { tolerateUnknown?: boolean },
  ) => Promise<void>;
  /** R3-A: the OLD manager bearer token surrendered by this browser. */
  managerTokenToRevoke?: string | null;
  /** R4-C: wipes the shared cookie when a banked success must be undone. */
  clearSession?: () => Promise<unknown>;
};

type SuperAdminLoginData = {
  mode: "legacy" | "individual";
  staffId?: string;
  password: string;
};

/**
 * Super Admin login core (review B9/A4). Rate-limit accounting is EXACT: the
 * limiter is reported exactly once — report(true) only AFTER the credentials
 * verified, the DB session was minted, AND the cookie update succeeded; every
 * other outcome (including a thrown cookie write) reports false first.
 * A successful login also strips every other staff role from the shared
 * session cookie (undefined-valued keys are removed by the session layer).
 */
export async function superAdminLoginCore(
  data: SuperAdminLoginData,
  deps: SuperAdminLoginDeps,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const fail = () => ({ ok: false as const, message: GENERIC_AUTH_FAILURE });
  const report = async (valid: boolean) => {
    try {
      await deps.report(valid);
    } catch {
      // the limiter must never break the login outcome
    }
  };
  /**
   * R4-C: a success stands only when the durable completion returns an
   * authoritative TRUE. false / throw / malformed = not confirmed: undo the
   * login (revoke the minted session, clear the cookie) and fail generically.
   * The report is never retried — one durable outcome per attempt.
   */
  const confirmDurableSuccess = async (): Promise<boolean> => {
    try {
      return (await deps.report(true)) === true;
    } catch {
      return false;
    }
  };
  /**
   * R3-A: revoke every OLD credential carried by this browser context before
   * the replacement session is minted. Throws on failure so the caller can
   * fail closed instead of leaving two usable credentials. Although the raw
   * values came from this browser, this is a mandatory credential handoff,
   * not optional cleanup: UNKNOWN_TOKEN is not proof that no live credential
   * remains and therefore aborts before any replacement is minted.
   */
  const revokePrevious = async () => {
    const cookie = deps.cookieStaffTokens ? await deps.cookieStaffTokens() : null;
    if (cookie?.superAdminToken) {
      await deps.revokeStaffSessionByToken?.("super_admin", cookie.superAdminToken);
    }
    if (cookie?.areaManagerToken) {
      await deps.revokeStaffSessionByToken?.("area_manager", cookie.areaManagerToken);
    }
    if (deps.managerTokenToRevoke) {
      await deps.revokeManagerSessionByToken?.(deps.managerTokenToRevoke);
    }
  };
  try {
    if (data.mode === "legacy") {
      let valid = false;
      try {
        valid = timingSafeEqualStr(data.password, deps.legacyPassword);
      } catch {
        valid = false;
      }
      if (!valid) {
        await report(false);
        return fail();
      }
      try {
        await revokePrevious();
      } catch {
        await report(false);
        return fail();
      }
      const { data: state, error } = await deps.rpc("bootstrap_super_admin_state", {});
      const raw = state as { open?: boolean; active_count?: number } | null;
      if (error || !raw || raw.open !== true || (raw.active_count ?? 0) > 0) {
        await report(false);
        return fail();
      }
      await deps.updateSession({
        superAdmin: true,
        superAdminAccountId: undefined,
        superAdminSessionToken: undefined,
        superAdminReauthenticatedAt: undefined,
        dashboard: undefined,
        areaManagerAccountId: undefined,
        areaManagerSessionToken: undefined,
      });
      // R4-C: no bearer session exists on the legacy path, but a completion
      // that did not confirm still must not leave the cookie logged in.
      if (!(await confirmDurableSuccess())) {
        await deps.clearSession?.().catch(() => undefined);
        return fail();
      }
      return { ok: true as const };
    }

    if (!data.staffId) {
      await report(false);
      return fail();
    }
    const { data: cred, error } = await deps.rpc("get_super_admin_credential", {
      p_staff_id: data.staffId,
    });
    const c = cred as { id: string; password_hash: string | null; status: string } | null;
    let valid = false;
    let accountId: string | null = null;
    if (!error && c && typeof c === "object" && c.status === "aktif" && c.password_hash) {
      valid = await deps.verify(data.password, c.password_hash).catch(() => false);
      accountId = c.id;
    }
    if (!valid || !accountId) {
      await report(false);
      return fail();
    }
    // R3-A: revoke the previous credentials BEFORE the new session exists —
    // a failed revocation aborts the switch with the old state intact.
    try {
      await revokePrevious();
    } catch {
      await report(false);
      return fail();
    }
    const { data: token, error: sessionError } = await deps.rpc("create_staff_session", {
      p_kind: "super_admin",
      p_account_id: accountId,
    });
    if (sessionError || typeof token !== "string" || !token) {
      await report(false);
      return fail();
    }
    try {
      await deps.updateSession({
        superAdmin: true,
        superAdminAccountId: accountId,
        superAdminSessionToken: token,
        superAdminReauthenticatedAt: undefined,
        dashboard: undefined,
        areaManagerAccountId: undefined,
        areaManagerSessionToken: undefined,
      });
    } catch {
      // R3-A.8: the cookie write failed — revoke the just-minted session so
      // no orphan bearer token survives, then account the attempt as a failure.
      await deps.revokeStaffSessionByToken?.("super_admin", token).catch(() => undefined);
      await report(false);
      return fail();
    }
    // R4-C: the usable cookie only stands on an authoritative completion.
    if (!(await confirmDurableSuccess())) {
      await deps.revokeStaffSessionByToken?.("super_admin", token).catch(() => undefined);
      await deps.clearSession?.().catch(() => undefined);
      return fail();
    }
    return { ok: true as const };
  } catch {
    // updateSession (cookie write) or an unexpected transport error — the
    // reservation must be accounted as a failure, never left open as success.
    await report(false);
    return fail();
  }
}

/**
 * Super Admin login, dua mode:
 *  - "legacy": shared-password bootstrap era. Hanya diizinkan selama gerbang
 *    bootstrap terbuka DAN belum ada akun individual aktif; sesi legacy tidak
 *    membawa account id dan mati permanen setelah cutover.
 *  - "individual": ID Super Admin + password terhadap super_admin_accounts;
 *    sesi membawa bearer token yang tervalidasi di DB tiap panggilan.
 */
export const loginSuperAdmin = createServerFn({ method: "POST" })
  .validator(loginInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const {
      isPasswordValid,
      updateAuthSession,
      readCookieStaffTokens,
      clearAuthSession,
      revokeStaffSessionByTokenIfLive,
      revokeManagerSessionByTokenIfLive,
    } = await import("./auth.server");
    const { getServiceClient } = await import("./remote-audio.server");
    const { verifyManagerPassword } = await import("./manager-password.server");
    const client = getServiceClient();
    if (!client) return ownerLoginFailure();
    const revocationDeps = {
      cookieStaffTokens: readCookieStaffTokens,
      // Mandatory role handoff is strict: only REVOKED / tombstone-proven
      // ALREADY_INACTIVE may proceed. UNKNOWN_TOKEN aborts before minting.
      revokeStaffSessionByToken: revokeStaffSessionByTokenIfLive,
      revokeManagerSessionByToken: revokeManagerSessionByTokenIfLive,
      managerTokenToRevoke: data.managerToken ?? null,
      clearSession: clearAuthSession,
    };

    if (data.mode === "legacy") {
      const expectedPassword = readEnv("SUPER_ADMIN_PASSWORD");
      if (expectedPassword === null) return ownerLoginFailure();
      return withLoginRateLimit(
        data.clientKey,
        data.attemptKey,
        (report) =>
          superAdminLoginCore(
            { mode: "legacy", password: data.password },
            {
              rpc: async (fn, params) => client.rpc(fn, params),
              report,
              verify: async (password, stored) => isPasswordValid(password, stored),
              updateSession: updateAuthSession,
              legacyPassword: expectedPassword,
              ...revocationDeps,
            },
          ),
        ownerLoginFailure,
      );
    }

    if (!data.staffId) return ownerLoginFailure();
    const { normalizeStaffId } = await import("./staff-identity.server");
    return withLoginRateLimit(
      data.clientKey,
      data.attemptKey,
      (report) =>
        superAdminLoginCore(
          {
            mode: "individual",
            staffId: normalizeStaffId(data.staffId ?? ""),
            password: data.password,
          },
          {
            rpc: async (fn, params) => client.rpc(fn, params),
            report,
            verify: verifyManagerPassword,
            updateSession: updateAuthSession,
            legacyPassword: "",
            ...revocationDeps,
          },
        ),
      ownerLoginFailure,
    );
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { getAuthSession, revokeStaffSessionByToken, clearAuthSession } =
    await import("./auth.server");
  // R3-A: revoke the CURRENT server session BEFORE clearing the cookie. On
  // revocation failure the cookie stays (fail closed) — the caller reports a
  // failed logout instead of silently leaving a live bearer behind. The
  // token is client-surrendered: UNKNOWN_TOKEN (purged elsewhere without a
  // tombstone) proves it is already unusable, so cleanup passes tolerance —
  // a dead token must not brick logout or the next login for this browser.
  const session = await getAuthSession();
  const token = session.data.superAdminSessionToken;
  if (token) {
    await revokeStaffSessionByToken("super_admin", token, { tolerateUnknown: true });
  }
  await clearAuthSession();
  return { ok: true };
});
