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
  // R6-C: idempotency key for the logical attempt. The same UNCONSUMED key
  // maps to the SAME rate-limit reservation, so a lost response + retry can
  // never create a second reservation or double-count. A key whose attempt
  // reached a final outcome is dead; the client generates a fresh key per
  // logical attempt. Every key still passes the SAME bucket enforcement.
  attemptKey: z.string().min(16).max(200),
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
      /** R6-C: finalized to SUCCEEDED by the browser's confirm call. */
      rateLimitReservationId: string;
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
  /**
   * R6-C: durable rate-limit completion. Returns the DB verdict; exactly one
   * final outcome per reservation (compare-and-set). See
   * OwnerLoginCompletionVerdict for the full set.
   */
  report: (
    valid: boolean,
  ) => Promise<
    | "SUCCEEDED"
    | "FAILED"
    | "ALREADY_SUCCEEDED"
    | "ALREADY_FAILED"
    | "EXPIRED"
    | "UNKNOWN_RESERVATION"
    | "MALFORMED"
    | "TIMEOUT"
  >;
  /**
   * R6-C: the reservation bound to THIS attempt. The manager namespace
   * REQUIRES one (success returns it for the browser confirm; absent ->
   * fail closed). Optional in the type so AM-only cores stay wireable.
   */
  rateLimitReservationId?: string | null;
  verify?: (password: string, stored: string) => Promise<boolean>;
  updateSession?: (update: Partial<TableTalkerSession>) => Promise<unknown>;
  /** Review A4: wipes the shared cookie session when a manager takes over. */
  clearSession?: () => Promise<unknown>;
  /** R3-A: bearer tokens currently held by this browser's session cookie. */
  cookieStaffTokens?: () => Promise<{
    superAdminToken: string | null;
    areaManagerToken: string | null;
  }>;
  /** R3-A: server-side revocation of one staff/manager bearer session.
   * Cleanup call sites pass tolerateUnknown for client-surrendered tokens. */
  revokeStaffSessionByToken?: (
    kind: "super_admin" | "area_manager",
    token: string,
    opts?: { tolerateUnknown?: boolean },
  ) => Promise<void>;
  revokeManagerSessionByToken?: (
    token: string,
    opts?: { tolerateUnknown?: boolean },
  ) => Promise<void>;
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
async function safeReport(report: StaffLoginDeps["report"], valid: boolean): Promise<void> {
  try {
    await report(valid);
  } catch {
    // the limiter must never break the login outcome
  }
}

/**
 * R6-C: finalize the AM completion. A success stands only on SUCCEEDED or
 * ALREADY_SUCCEEDED (the latter proves the DB banked a success for THIS
 * reservation — the cookie-written session is real). Any other verdict is
 * not a confirmed success: a durable failure outcome is recorded (the CAS
 * makes a late reporter unable to contradict it) and the caller compensates.
 * Exactly ONE final outcome exists per reservation. Bounded by the limiter
 * module's own timeout.
 */
async function finalizeAreaManagerCompletion(deps: StaffLoginDeps): Promise<boolean> {
  let verdict: Awaited<ReturnType<StaffLoginDeps["report"]>>;
  try {
    verdict = await deps.report(true);
  } catch {
    verdict = "UNKNOWN_RESERVATION";
  }
  if (verdict === "SUCCEEDED" || verdict === "ALREADY_SUCCEEDED") return true;
  // Not a confirmed success: bank the failure durably.
  try {
    const failVerdict = await deps.report(false);
    if (failVerdict === "ALREADY_SUCCEEDED") return true;
  } catch {
    // limiter unavailable; the reservation expires unconsumed (bounded)
  }
  return false;
}

/**
 * R3-A: revokes every OLD credential carried by this browser context
 * (cookie staff bearers + the surrendered manager token). Throws on failure
 * so the caller can fail closed instead of leaving two usable credentials.
 * These tokens are CLIENT-SURRENDERED: an UNKNOWN_TOKEN verdict proves the
 * token was already purged elsewhere (newest-wins supersede, account-wide
 * revoke, cutover delete — none of which leave tombstones), so it cannot
 * authenticate anything and cleanup must NOT brick this login.
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
  const managerResult = deps.rateLimitReservationId
    ? await loginManagerCore(
        {
          idManager: staffId,
          password,
          rateLimitReservationId: deps.rateLimitReservationId,
        },
        {
          rpc: deps.rpc,
          rateLimitReservationId: deps.rateLimitReservationId,
          verify: deps.verify ?? verifyManagerPassword,
        },
      )
    : null;
  if (managerResult?.ok) {
    // R3-A: a manager takeover must revoke the PREVIOUS server sessions of
    // this browser context. On revocation failure the login fails closed:
    // the freshly minted PENDING session is never delivered to the browser —
    // unusable by construction, it expires via its 60s TTL — and the durable
    // rate-limit outcome is recorded as a failure (R6-C).
    try {
      if (managerTokenToRevoke) {
        // Surrendered sessionStorage token: dead (purged elsewhere) is fine.
        await deps.revokeManagerSessionByToken?.(managerTokenToRevoke);
      }
      await revokePreviousCredentials(deps, { managerTokenToRevoke: null });
    } catch {
      if (deps.rateLimitReservationId) await safeReport(deps.report, false);
      return { ok: false, message: GENERIC };
    }
    // Review A4: wipe the shared cookie AFTER the server-side revocations.
    await deps.clearSession?.().catch(() => undefined);
    // R6-C: the PENDING session is returned to the browser. The durable
    // rate-limit outcome is NOT finalized here — the browser's confirm call
    // activates the session AND banks the success in one DB transaction, so
    // a failed/abandoned handoff can never leave a usable session behind.
    if (!deps.rateLimitReservationId) {
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
      rateLimitReservationId: deps.rateLimitReservationId,
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
    // so no orphan bearer token survives. R6-C: the durable rate-limit
    // outcome is recorded as a failure (the compare-and-set makes a late
    // success reporter unable to contradict the DB).
    await deps.revokeStaffSessionByToken?.("area_manager", token).catch(() => undefined);
    if (deps.rateLimitReservationId) await safeReport(deps.report, false);
    return { ok: false, message: GENERIC };
  }
  // R6-C: complete only AFTER the cookie write made the login usable, and
  // the login only stands on an authoritative success verdict.
  if (!(await finalizeAreaManagerCompletion(deps))) {
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
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey, data.attemptKey);
    if (!reservationId) return { ok: false, message: GENERIC };

    return loginStaffCore(
      data.staffId,
      data.password,
      {
        rpc: async (fn, params) => client.rpc(fn, params),
        report: (valid) => completeOwnerLoginAttempt(reservationId, valid),
        rateLimitReservationId: reservationId,
        updateSession: updateAuthSession,
        clearSession: clearAuthSession,
        // R3-A: server-authoritative revocation of the previous credentials.
        // R4-B: cookie/sessionStorage tokens may already be dead — dead ones
        // are skipped (provably unusable), live ones are revoked with
        // mandatory semantics (a no-op fails closed).
        cookieStaffTokens: readCookieStaffTokens,
        revokeStaffSessionByToken: revokeStaffSessionByTokenIfLive,
        revokeManagerSessionByToken: revokeManagerSessionByTokenIfLive,
        managerExtras: (staffId) => managerPasswordChangedAt(client, staffId),
      },
      { managerTokenToRevoke: data.managerToken ?? null },
    );
  });

/**
 * Reads password_changed_at for a manager account. Legacy rows may carry
 * mixed-case ids ("AgusKasir") while callers pass the normalized lowercase
 * id, so the lookup is case-insensitive (ilike) with LIKE-wildcards escaped
 * — a missed row would falsely trigger the "change your password" reminder.
 */
export async function managerPasswordChangedAt(
  client: {
    from: (table: string) => {
      select: (columns: string) => {
        ilike: (
          column: string,
          pattern: string,
        ) => {
          single: () => PromiseLike<{ data: unknown; error: unknown }>;
        };
      };
    };
  },
  staffId: string,
): Promise<{ password_changed_at: string | null } | null> {
  const { data: extra, error } = await client
    .from("manager_accounts")
    .select("id, password_changed_at")
    // PostgREST ilike (v11+): backslash escapes the glob metas * and . as
    // well as SQL LIKE's % and _, so the id matches literally. STAFF_ID_PATTERN
    // allows only [a-z0-9._-], so these are all the metas an id can carry.
    .ilike(
      "id_manager",
      staffId.replace(/[\\%_*.]/g, (m) => `\\${m}`),
    )
    .single();
  if (error || !extra || typeof extra !== "object") return null;
  return extra as { password_changed_at: string | null };
}

// R5-A + R6-C: pending→active handshake with durable outcome finalization.
// confirmManagerHandoff activates the pending session AND banks the rate-limit
// success in ONE DB transaction (confirm_manager_session(p_token,
// p_reservation_id)). Idempotent: a lost response + retry returns the same
// verdict without duplicating anything. A reservation that was already
// decided (or is missing/expired) activates NOTHING.
export const confirmManagerHandoffInput = z.object({
  managerToken: z.string().min(1).max(200),
  rateLimitReservationId: z.string().uuid(),
});

type HandoffRpcClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type ManagerHandoffRequest = z.infer<typeof confirmManagerHandoffInput>;

/**
 * A thrown RPC call is a transport-loss signal, not an authoritative failure.
 * It must cross the server-function boundary so the browser handoff retries the
 * same token + reservation and reconciles a commit whose response was lost.
 */
export async function confirmManagerHandoffCore(
  client: HandoffRpcClient,
  data: ManagerHandoffRequest,
): Promise<boolean> {
  const { data: result, error } = await client.rpc("confirm_manager_session", {
    p_token: data.managerToken,
    p_reservation_id: data.rateLimitReservationId,
  });
  return !error && result === true;
}

export const confirmManagerHandoff = createServerFn({ method: "POST" })
  .validator(confirmManagerHandoffInput)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const client = getServiceClient();
    if (!client) return { ok: false };
    return { ok: await confirmManagerHandoffCore(client, data) };
  });

// R5-A + R6-C: failure-path cleanup. The unconfirmed pending session is
// deleted (it was never usable) and the durable rate-limit outcome is banked
// as a failure — a handoff that never reached confirm never becomes a
// silent success in the accounting.
export const cleanupManagerPendingSessionInput = z.object({
  managerToken: z.string().min(1).max(200),
  rateLimitReservationId: z.string().uuid().optional(),
});

type FailureCompleter = (
  reservationId: string,
  success: false,
) => Promise<Awaited<ReturnType<StaffLoginDeps["report"]>>>;

/** Cleanup is successful only when both pending deletion and durable failure
 * accounting are authoritative. Transport, timeout, malformed, and unknown
 * states are surfaced to the browser as cleanup_failed rather than swallowed. */
export async function cleanupManagerPendingSessionCore(
  client: HandoffRpcClient,
  data: ManagerHandoffRequest,
  complete: FailureCompleter,
): Promise<boolean> {
  const { data: cleaned, error } = await client.rpc("cleanup_pending_manager_session", {
    p_token: data.managerToken,
    p_reservation_id: data.rateLimitReservationId,
  });
  if (error || cleaned !== true) return false;
  const verdict = await complete(data.rateLimitReservationId, false);
  return verdict === "FAILED" || verdict === "ALREADY_FAILED";
}

export const cleanupManagerPendingSession = createServerFn({ method: "POST" })
  .validator(cleanupManagerPendingSessionInput)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const client = getServiceClient();
    if (!client || !data.rateLimitReservationId) return { ok: false };
    const { completeOwnerLoginAttempt } = await import("./owner-login-rate-limit.server");
    return {
      ok: await cleanupManagerPendingSessionCore(
        client,
        { ...data, rateLimitReservationId: data.rateLimitReservationId },
        completeOwnerLoginAttempt,
      ),
    };
  });
