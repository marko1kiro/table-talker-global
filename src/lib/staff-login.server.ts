// Shared staff login for Manager + Area Manager (one page, ID + password).
// Role is derived authoritatively from the DB, never from the client. The
// rate-limit reservation happens BEFORE any password hashing so attackers
// cannot burn scrypt CPU without passing the bucket gate. Failure responses
// are generic (no account enumeration).
//
// Accounting rule (review B12): a reservation is marked SUCCESS only when a
// usable session was actually established. Wrong password, unknown ID,
// inactive account, and session-mint RPC errors are all failures.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  updateAuthSession,
  clearAuthSession,
  readCookieStaffTokens,
  revokeStaffSessionByTokenIfLive,
  revokeManagerSessionByToken,
  revokeManagerSessionByTokenIfLive,
  type TableTalkerSession,
} from "./auth.server";
import { loginManagerCore } from "./manager-auth.server";
import { verifyManagerPassword } from "./manager-password.server";
import { getServiceClient } from "./remote-audio.server";
import { normalizeStaffId, GENERIC_AUTH_FAILURE } from "./staff-identity.server";

const GENERIC = GENERIC_AUTH_FAILURE;

export const loginStaffInputSchema = z.object({
  staffId: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
  clientKey: z.string().min(16).max(200),
  // R3-A: the OLD manager bearer token surrendered on a role switch.
  managerToken: z.string().min(1).max(200).optional(),
});

export type LoginStaffResult =
  | {
      ok: true;
      role: "manager";
      managerToken: string;
      idManager: string;
      fullName: string;
      restaurantId: string;
      restaurantDisplayName: string;
      restaurantCode: string;
      mustRemindPassword: boolean;
    }
  | {
      ok: true;
      role: "area_manager";
      fullName: string;
      staffId: string;
      mustRemindPassword: boolean;
    }
  | { ok: false; message: string };

type RpcCaller = (
  fn: string,
  params: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type StaffLoginDeps = {
  rpc: RpcCaller;
  report: (valid: boolean) => Promise<unknown>;
  verify?: (password: string, stored: string) => Promise<boolean>;
  updateSession?: (update: Partial<TableTalkerSession>) => Promise<unknown>;
  /** Review A4: wipes the shared cookie session when a manager takes over. */
  clearSession?: () => Promise<unknown>;
  /** R3-A: bearer tokens currently held by this browser's session cookie. */
  cookieStaffTokens?: () => Promise<{
    superAdminToken: string | null;
    areaManagerToken: string | null;
  }>;
  /** R3-A: server-side revocation of one staff/manager bearer session. */
  revokeStaffSessionByToken?: (
    kind: "super_admin" | "area_manager",
    token: string,
  ) => Promise<void>;
  revokeManagerSessionByToken?: (token: string) => Promise<void>;
  /** R3-A alternative placement (see LoginStaffOpts). */
  managerTokenToRevoke?: string | null;
  managerExtras?: (staffId: string) => Promise<{ password_changed_at: string | null } | null>;
};

export type LoginStaffOpts = {
  /**
   * R3-A: the OLD manager bearer token (from this browser's sessionStorage)
   * to surrender when switching Manager -> SA/AM or Manager -> Manager.
   * Revoked server-side through the service-role RPC.
   */
  managerTokenToRevoke?: string | null;
};

/** Reports exactly once and never lets a limiter outage flip the outcome. */
async function safeReport(
  report: (valid: boolean) => Promise<unknown>,
  valid: boolean,
): Promise<void> {
  try {
    await report(valid);
  } catch {
    // the limiter must never break the login outcome
  }
}

/**
 * R4-C: a success is only banked when the durable rate-limit completion
 * returns an authoritative TRUE. false / throw / malformed / timeout all mean
 * "completion not confirmed" — the caller must compensate (revoke the minted
 * session, clear the cookie) and return a generic failure. Exactly ONE report
 * happens per attempt: a failed completion is never retried (that would
 * double-report and could flip a failed attempt into a success).
 */
async function confirmDurableSuccess(deps: StaffLoginDeps): Promise<boolean> {
  try {
    return (await deps.report(true)) === true;
  } catch {
    return false;
  }
}

/**
 * R3-A: revokes every OLD credential carried by this browser context
 * (cookie staff bearers + the surrendered manager token). Throws on failure
 * so the caller can fail closed instead of leaving two usable credentials.
 */
async function revokePreviousCredentials(
  deps: StaffLoginDeps,
  opts: LoginStaffOpts,
): Promise<void> {
  const cookie = deps.cookieStaffTokens ? await deps.cookieStaffTokens() : null;
  if (cookie?.superAdminToken) {
    await deps.revokeStaffSessionByToken?.("super_admin", cookie.superAdminToken);
  }
  if (cookie?.areaManagerToken) {
    await deps.revokeStaffSessionByToken?.("area_manager", cookie.areaManagerToken);
  }
  if (opts.managerTokenToRevoke) {
    await deps.revokeManagerSessionByToken?.(opts.managerTokenToRevoke);
  }
}

export async function loginStaffCore(
  rawStaffId: string,
  password: string,
  deps: StaffLoginDeps,
  opts: LoginStaffOpts = {},
): Promise<LoginStaffResult> {
  const staffId = normalizeStaffId(rawStaffId);
  const managerTokenToRevoke = opts.managerTokenToRevoke ?? deps.managerTokenToRevoke ?? null;

  // 1) Manager namespace first (existing bearer-token dashboard model).
  //    loginManagerCore mints the session internally, so its ok flag already
  //    means "usable session established".
  const managerResult = await loginManagerCore(
    { idManager: staffId, password },
    {
      rpc: deps.rpc,
      verify: deps.verify ?? verifyManagerPassword,
    },
  ).catch(() => null);
  if (managerResult?.ok) {
    // R3-A: a manager takeover must revoke the PREVIOUS server sessions of
    // this browser context. On revocation failure the freshly minted manager
    // session is revoked too (compensation) so no pair of usable credentials
    // and no orphan session survives.
    try {
      if (managerTokenToRevoke) {
        await deps.revokeManagerSessionByToken?.(managerTokenToRevoke);
      }
      await revokePreviousCredentials(deps, { managerTokenToRevoke: null });
    } catch {
      await deps.revokeManagerSessionByToken?.(managerResult.managerToken).catch(() => undefined);
      await safeReport(deps.report, false);
      return { ok: false, message: GENERIC };
    }
    // Review A4: wipe the shared cookie AFTER the server-side revocations.
    await deps.clearSession?.().catch(() => undefined);
    // R4-C: the login is only usable once the durable completion confirms.
    if (!(await confirmDurableSuccess(deps))) {
      await deps.revokeManagerSessionByToken?.(managerResult.managerToken).catch(() => undefined);
      return { ok: false, message: GENERIC };
    }
    const extras = deps.managerExtras
      ? await deps.managerExtras(staffId)
      : { password_changed_at: "set" };
    const mustRemindPassword = !extras || extras.password_changed_at === null;
    return {
      ok: true,
      role: "manager",
      managerToken: managerResult.managerToken,
      idManager: managerResult.idManager,
      fullName: managerResult.fullName,
      restaurantId: managerResult.restaurantId,
      restaurantDisplayName: managerResult.restaurantDisplayName,
      restaurantCode: managerResult.restaurantCode,
      mustRemindPassword,
    };
  }

  // 2) Area Manager namespace (cookie session backed by staff_sessions).
  const { data: cred, error: amError } = await deps.rpc("get_area_manager_credential", {
    p_staff_id: staffId,
  });
  const am = cred as {
    id: string;
    password_hash: string | null;
    status: string;
    full_name: string;
    staff_id: string;
    password_changed_at: string | null;
  } | null;
  let amValid = false;
  if (!amError && am && typeof am === "object" && am.status === "aktif" && am.password_hash) {
    amValid = await (deps.verify ?? verifyManagerPassword)(password, am.password_hash).catch(
      () => false,
    );
  }
  if (!amValid || !am) {
    await safeReport(deps.report, false);
    return { ok: false, message: GENERIC };
  }
  // R3-A: revoke the previous credentials of this browser context BEFORE the
  // new session is minted — a failed revocation aborts the switch with the
  // old credentials intact and nothing new minted.
  try {
    await revokePreviousCredentials(deps, { managerTokenToRevoke });
  } catch {
    await safeReport(deps.report, false);
    return { ok: false, message: GENERIC };
  }
  const { data: token, error: sessionError } = await deps.rpc("create_staff_session", {
    p_kind: "area_manager",
    p_account_id: am.id,
  });
  if (sessionError || typeof token !== "string" || !token) {
    // Password was right but no session exists — never count this as success.
    await safeReport(deps.report, false);
    return { ok: false, message: GENERIC };
  }
  const updateSession = deps.updateSession ?? ((u) => updateAuthSession(u));
  try {
    // Review A4 + R3-C: an AM login strips every Super Admin field from the
    // shared cookie (undefined-valued keys are removed by the session layer).
    await updateSession({
      areaManagerAccountId: am.id,
      areaManagerSessionToken: token,
      superAdmin: undefined,
      superAdminAccountId: undefined,
      superAdminSessionToken: undefined,
      superAdminReauthenticatedAt: undefined,
      dashboard: undefined,
    });
  } catch {
    // R3-A.8/R3-C: the cookie write failed — revoke the just-minted session
    // so no orphan bearer token survives, and account the attempt as a failure.
    await deps.revokeStaffSessionByToken?.("area_manager", token).catch(() => undefined);
    await safeReport(deps.report, false);
    return { ok: false, message: GENERIC };
  }
  // R4-C: report(true) only AFTER the cookie write made the login usable,
  // and the login only stands when the completion is authoritatively true.
  if (!(await confirmDurableSuccess(deps))) {
    await deps.revokeStaffSessionByToken?.("area_manager", token).catch(() => undefined);
    await deps.clearSession?.().catch(() => undefined);
    return { ok: false, message: GENERIC };
  }
  return {
    ok: true,
    role: "area_manager",
    fullName: am.full_name,
    staffId: am.staff_id,
    mustRemindPassword: am.password_changed_at === null,
  };
}

export const loginStaff = createServerFn({ method: "POST" })
  .validator(loginStaffInputSchema)
  .handler(async ({ data }): Promise<LoginStaffResult> => {
    const client = getServiceClient();
    if (!client) return { ok: false, message: GENERIC };

    const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return { ok: false, message: GENERIC };

    return loginStaffCore(
      data.staffId,
      data.password,
      {
        rpc: async (fn, params) => client.rpc(fn, params),
        report: (valid) => completeOwnerLoginAttempt(reservationId, valid),
        updateSession: updateAuthSession,
        clearSession: clearAuthSession,
        // R3-A: server-authoritative revocation of the previous credentials.
        // R4-B: cookie/sessionStorage tokens may already be dead — dead ones
        // are skipped (provably unusable), live ones are revoked with
        // mandatory semantics (a no-op fails closed).
        cookieStaffTokens: readCookieStaffTokens,
        revokeStaffSessionByToken: revokeStaffSessionByTokenIfLive,
        revokeManagerSessionByToken: revokeManagerSessionByTokenIfLive,
        managerExtras: async (staffId) => {
          const { data: extra, error } = await client
            .from("manager_accounts")
            .select("id, password_changed_at")
            .eq("id_manager", staffId)
            .single();
          if (error || !extra) return { password_changed_at: null };
          return extra as { password_changed_at: string | null };
        },
      },
      { managerTokenToRevoke: data.managerToken ?? null },
    );
  });

// R4-A: browser handoff compensation. The server has already minted the
// manager session when the browser starts its handoff (anon token, identity
// write, navigation); any failure there must end the session server-side.
// Idempotent logout semantics: a false verdict proves the token is already
// unusable, so only errors fail the compensation. The raw token is its own
// revocation proof (same trust model as the logout endpoint) and travels only
// in this POST body.
export const revokeManagerLoginCompensationInput = z.object({
  managerToken: z.string().min(1).max(200),
});

export const revokeManagerLoginCompensation = createServerFn({ method: "POST" })
  .validator(revokeManagerLoginCompensationInput)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      // Idempotent cleanup semantics (R4-B): false proves the token is
      // already unusable; only transport/malformed errors fail the call.
      // No liveness probe here — a probe failure must not read as "done".
      await revokeManagerSessionByToken(data.managerToken);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
