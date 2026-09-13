// Poin 3 Task 6: crew auth server functions. Browser-facing fns forward the
// caller's GoTrue access token and run every RPC through
// getAnonAuthedSupabaseClient (the crew account RPCs are revoked from
// service_role, granted to authenticated, and auth.uid()-scoped) --
// the service-role client can never call these RPCs and is never built here.
// Manager-facing fns copy manager-dashboard.server.ts's transport exactly:
// anon-authed client + the manager bearer token as p_manager_token (the RPC
// hashes and validates it; INVALID_SESSION on failure).
//
// node:crypto and the envelope codec are imported dynamically, never at the
// top: UI routes (CrewLoginFlow.tsx) import these createServerFn exports, and a
// static node:crypto import on the module graph gets pulled into the client
// bundle by Vite (guarded by tests/restaurant-login-build.test.ts).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CREW_ROLES, type CrewRole } from "./role-session-domain";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";

const GENERIC_VALIDATE = "Gagal memverifikasi kode resto.";
const GENERIC_REQUEST_PAIRING = "Gagal mengajukan permintaan pairing.";
const GENERIC_CONFIRM_PAIRING = "Gagal mengonfirmasi pairing.";
const GENERIC_ME = "Gagal memuat akun crew.";
const GENERIC_CLAIM = "Gagal memulai sesi kerja.";
const GENERIC_LIST_PAIRING = "Gagal memuat daftar permintaan crew.";
const GENERIC_REJECT = "Gagal menolak permintaan crew.";
const GENERIC_LIST_ACCOUNTS = "Gagal memuat daftar akun crew.";
const GENERIC_RESET = "Gagal mereset akun crew.";
const GENERIC_END_SESSIONS = "Gagal mengakhiri sesi crew.";

function knownRaisedCode<T extends string>(known: readonly T[], message: string): T | null {
  return (known as readonly string[]).includes(message) ? (message as T) : null;
}

// ---------------------------------------------------------------------------
// crewValidateCode
// ---------------------------------------------------------------------------

const VALIDATE_RAISED = ["INVALID_CODE", "UNAUTHORIZED"] as const;

export type CrewValidateCodeResult =
  | { ok: true; restaurantId: string; displayName: string }
  | { ok: false; code: (typeof VALIDATE_RAISED)[number] | "UNAVAILABLE"; message: string };

export const crewValidateCodeInputSchema = z.object({
  accessToken: z.string().min(1),
  code: z.string().trim().min(1).max(32),
});

export async function crewValidateCodeCore(
  data: { code: string },
  rpc: RpcCaller,
): Promise<CrewValidateCodeResult> {
  try {
    const { data: result, error } = await rpc("crew_validate_code", { p_code: data.code });
    if (error) {
      return {
        ok: false,
        code: knownRaisedCode(VALIDATE_RAISED, error.message) ?? "UNAVAILABLE",
        message: GENERIC_VALIDATE,
      };
    }
    const raw = result as { restaurant_id?: unknown; display_name?: unknown } | null;
    if (!raw || typeof raw.restaurant_id !== "string" || typeof raw.display_name !== "string") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_VALIDATE };
    }
    return { ok: true, restaurantId: raw.restaurant_id, displayName: raw.display_name };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_VALIDATE };
  }
}

export const crewValidateCode = createServerFn({ method: "POST" })
  .validator(crewValidateCodeInputSchema)
  .handler(async ({ data }): Promise<CrewValidateCodeResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_VALIDATE };
    return crewValidateCodeCore({ code: data.code }, async (fn, params) => client.rpc(fn, params));
  });

// ---------------------------------------------------------------------------
// crewRequestPairing (OTP generated server-side; hash + envelope never leave)
// ---------------------------------------------------------------------------

const REQUEST_PAIRING_RAISED = [
  "UNAUTHORIZED",
  "INVALID_NAME",
  "INTERNAL",
  "INVALID_CODE",
  "ALREADY_PAIRED",
] as const;

export type CrewRequestPairingResult =
  | { ok: true; requestId: string }
  | {
      ok: false;
      code: (typeof REQUEST_PAIRING_RAISED)[number] | "PAIRING_THROTTLED" | "UNAVAILABLE";
      message: string;
    };

export const crewRequestPairingInputSchema = z.object({
  accessToken: z.string().min(1),
  restaurantId: z.string().uuid(),
  fullName: z.string().trim().min(1).max(40),
});

// CSPRNG 6-digit OTP (crypto.randomInt, zero-padded), per plan Task 6.
export async function generatePairingOtp(): Promise<string> {
  const { randomInt } = await import("node:crypto");
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function crewRequestPairingCore(
  data: { restaurantId: string; fullName: string; otp: string },
  rpc: RpcCaller,
): Promise<CrewRequestPairingResult> {
  try {
    const { createHash } = await import("node:crypto");
    const { encryptEnvelopeHex } = await import("./app-envelope-crypto.server");
    const otpHash = createHash("sha256").update(data.otp).digest("hex");
    const otpEncrypted = encryptEnvelopeHex(data.otp);
    const { data: result, error } = await rpc("crew_request_pairing", {
      p_restaurant_id: data.restaurantId,
      p_full_name: data.fullName,
      p_otp_hash: otpHash,
      p_otp_encrypted: otpEncrypted,
    });
    if (error) {
      return {
        ok: false,
        code: knownRaisedCode(REQUEST_PAIRING_RAISED, error.message) ?? "UNAVAILABLE",
        message: GENERIC_REQUEST_PAIRING,
      };
    }
    const raw = result as { ok?: unknown; request_id?: unknown; error?: unknown } | null;
    if (raw && raw.ok === false && raw.error === "PAIRING_THROTTLED") {
      return { ok: false, code: "PAIRING_THROTTLED", message: GENERIC_REQUEST_PAIRING };
    }
    if (!raw || raw.ok !== true || typeof raw.request_id !== "string") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_REQUEST_PAIRING };
    }
    return { ok: true, requestId: raw.request_id };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_REQUEST_PAIRING };
  }
}

export const crewRequestPairing = createServerFn({ method: "POST" })
  .validator(crewRequestPairingInputSchema)
  .handler(async ({ data }): Promise<CrewRequestPairingResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_REQUEST_PAIRING };
    const otp = await generatePairingOtp();
    return crewRequestPairingCore(
      { restaurantId: data.restaurantId, fullName: data.fullName, otp },
      async (fn, params) => client.rpc(fn, params),
    );
  });

// ---------------------------------------------------------------------------
// crewConfirmPairing
// ---------------------------------------------------------------------------

const CONFIRM_RAISED = ["UNAUTHORIZED", "INTERNAL", "NOT_FOUND"] as const;
const CONFIRM_RETURNED = [
  "EXPIRED",
  "NOT_PENDING",
  "INVALID_OTP",
  "TOO_MANY_ATTEMPTS",
  "INVALID_CODE",
] as const;
type CrewConfirmFailCode =
  | (typeof CONFIRM_RAISED)[number]
  | (typeof CONFIRM_RETURNED)[number]
  | "UNAVAILABLE";

export type CrewConfirmPairingResult =
  | { ok: true }
  | { ok: false; code: CrewConfirmFailCode; message: string };

export const crewConfirmPairingInputSchema = z.object({
  accessToken: z.string().min(1),
  requestId: z.string().uuid(),
  otp: z.string().regex(/^[0-9]{6}$/, "OTP harus 6 digit angka."),
});

export async function crewConfirmPairingCore(
  data: { requestId: string; otp: string },
  rpc: RpcCaller,
): Promise<CrewConfirmPairingResult> {
  try {
    const { createHash } = await import("node:crypto");
    const otpHash = createHash("sha256").update(data.otp).digest("hex");
    const { data: result, error } = await rpc("crew_confirm_pairing", {
      p_request_id: data.requestId,
      p_otp_hash: otpHash,
    });
    if (error) {
      return {
        ok: false,
        code: knownRaisedCode(CONFIRM_RAISED, error.message) ?? "UNAVAILABLE",
        message: GENERIC_CONFIRM_PAIRING,
      };
    }
    const raw = result as { ok?: unknown; error?: unknown } | null;
    if (!raw) return { ok: false, code: "UNAVAILABLE", message: GENERIC_CONFIRM_PAIRING };
    if (raw.ok === true) return { ok: true };
    if (
      typeof raw.error === "string" &&
      (CONFIRM_RETURNED as readonly string[]).includes(raw.error)
    ) {
      return {
        ok: false,
        code: raw.error as CrewConfirmFailCode,
        message: GENERIC_CONFIRM_PAIRING,
      };
    }
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_CONFIRM_PAIRING };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_CONFIRM_PAIRING };
  }
}

export const crewConfirmPairing = createServerFn({ method: "POST" })
  .validator(crewConfirmPairingInputSchema)
  .handler(async ({ data }): Promise<CrewConfirmPairingResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_CONFIRM_PAIRING };
    return crewConfirmPairingCore(
      { requestId: data.requestId, otp: data.otp },
      async (fn, params) => client.rpc(fn, params),
    );
  });

// ---------------------------------------------------------------------------
// crewMe
// ---------------------------------------------------------------------------

const ME_RAISED = ["UNAUTHORIZED"] as const;

export type CrewMeResult =
  | {
      ok: true;
      paired: boolean;
      status: string | null;
      fullName: string | null;
      restaurantId: string | null;
      restaurantName: string | null;
      deviceCurrent: boolean;
    }
  | { ok: false; code: "UNAUTHORIZED" | "UNAVAILABLE"; message: string };

export const crewMeInputSchema = z.object({
  accessToken: z.string().min(1),
  deviceToken: z.string().min(16),
});

export async function crewMeCore(
  data: { deviceToken: string },
  rpc: RpcCaller,
): Promise<CrewMeResult> {
  try {
    const { data: result, error } = await rpc("crew_me", { p_device_token: data.deviceToken });
    if (error) {
      return {
        ok: false,
        code: knownRaisedCode(ME_RAISED, error.message) ?? "UNAVAILABLE",
        message: GENERIC_ME,
      };
    }
    const raw = result as Record<string, unknown> | null;
    if (!raw || typeof raw.paired !== "boolean") {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_ME };
    }
    if (!raw.paired) {
      return {
        ok: true,
        paired: false,
        status: null,
        fullName: null,
        restaurantId: null,
        restaurantName: null,
        deviceCurrent: false,
      };
    }
    if (
      typeof raw.status !== "string" ||
      typeof raw.full_name !== "string" ||
      typeof raw.restaurant_id !== "string"
    ) {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_ME };
    }
    return {
      ok: true,
      paired: true,
      status: raw.status,
      fullName: raw.full_name,
      restaurantId: raw.restaurant_id,
      restaurantName: typeof raw.restaurant_name === "string" ? raw.restaurant_name : null,
      deviceCurrent: raw.device_current === true,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_ME };
  }
}

export const crewMe = createServerFn({ method: "POST" })
  .validator(crewMeInputSchema)
  .handler(async ({ data }): Promise<CrewMeResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_ME };
    return crewMeCore({ deviceToken: data.deviceToken }, async (fn, params) =>
      client.rpc(fn, params),
    );
  });

// ---------------------------------------------------------------------------
// crewClaimShift
// ---------------------------------------------------------------------------

const CLAIM_RAISED = [
  "UNAUTHORIZED",
  "INVALID_DEVICE",
  "INVALID_ROLE",
  "INVALID_CHECKED_IN_AT",
  "NOT_PAIRED",
  "ACCOUNT_DISABLED",
] as const;
type CrewClaimFailCode = (typeof CLAIM_RAISED)[number] | "UNAVAILABLE";

export type CrewClaimShiftResult =
  | {
      ok: true;
      sessionId: string;
      role: CrewRole;
      displayName: string;
      checkedInAt: string;
      sessionToken: string;
      tenantToken: string;
      restaurantId: string;
      restaurantName: string;
      restaurantCode: string;
    }
  | { ok: false; code: CrewClaimFailCode; message: string };

export const crewClaimShiftInputSchema = z.object({
  accessToken: z.string().min(1),
  role: z.enum(CREW_ROLES),
  checkedInAt: z.string().datetime({ offset: true }),
  deviceToken: z.string().min(16),
});

// crew_shift_claim returns { session, session_token } jsonb plus the tenant
// token and the server-derived restaurant identity (Task 5).
export async function crewClaimShiftCore(
  data: { role: CrewRole; checkedInAt: string; deviceToken: string },
  rpc: RpcCaller,
): Promise<CrewClaimShiftResult> {
  try {
    const { data: result, error } = await rpc("crew_shift_claim", {
      p_role: data.role,
      p_checked_in_at: data.checkedInAt,
      p_device_token: data.deviceToken,
    });
    if (error) {
      return {
        ok: false,
        code: knownRaisedCode(CLAIM_RAISED, error.message) ?? "UNAVAILABLE",
        message: GENERIC_CLAIM,
      };
    }
    const payload = result as {
      session?: Record<string, unknown>;
      session_token?: unknown;
      tenant_token?: unknown;
      restaurant_id?: unknown;
      restaurant_name?: unknown;
      restaurant_code?: unknown;
    } | null;
    const session = payload?.session;
    if (
      !session ||
      typeof session.id !== "string" ||
      typeof session.display_name !== "string" ||
      typeof session.checked_in_at !== "string" ||
      typeof payload?.session_token !== "string" ||
      typeof payload.tenant_token !== "string" ||
      typeof payload.restaurant_id !== "string" ||
      typeof payload.restaurant_name !== "string" ||
      typeof payload.restaurant_code !== "string"
    ) {
      return { ok: false, code: "UNAVAILABLE", message: GENERIC_CLAIM };
    }
    return {
      ok: true,
      sessionId: session.id,
      role: session.role as CrewRole,
      displayName: session.display_name,
      checkedInAt: session.checked_in_at,
      sessionToken: payload.session_token,
      tenantToken: payload.tenant_token,
      restaurantId: payload.restaurant_id,
      restaurantName: payload.restaurant_name,
      restaurantCode: payload.restaurant_code,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC_CLAIM };
  }
}

export const crewClaimShift = createServerFn({ method: "POST" })
  .validator(crewClaimShiftInputSchema)
  .handler(async ({ data }): Promise<CrewClaimShiftResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC_CLAIM };
    return crewClaimShiftCore(
      { role: data.role, checkedInAt: data.checkedInAt, deviceToken: data.deviceToken },
      async (fn, params) => client.rpc(fn, params),
    );
  });

// ---------------------------------------------------------------------------
// Manager-facing (JWT carrier + p_manager_token, same transport as
// manager-dashboard.server.ts's getManagerSnapshot)
// ---------------------------------------------------------------------------

function managerClientFn(accessToken: string) {
  const client = getAnonAuthedSupabaseClient(accessToken);
  return client
    ? async (fn: string, params: Record<string, unknown>) => client.rpc(fn, params)
    : null;
}

const MANAGER_RAISED = ["INVALID_SESSION"] as const;

function managerFail(code: "INVALID_SESSION" | "UNAVAILABLE", message: string) {
  return { ok: false as const, code, message };
}

export type CrewPairingRequestRow = {
  id: string;
  email: string;
  fullName: string;
  otp: string;
  createdAt: string;
  expiresAt: string;
};

export type CrewPairingListResult =
  | { ok: true; requests: CrewPairingRequestRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export const crewPairingListInputSchema = z.object({
  accessToken: z.string().min(1),
  managerToken: z.string().min(1),
});

// Decrypts each row's otp_encrypted envelope server-side. A single
// undecryptable row fails the WHOLE list (never partial results, and the
// plaintext OTP is only ever handed to the manager UI over the authenticated
// transport it already uses for its own dashboard).
export async function crewPairingListCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<CrewPairingListResult> {
  try {
    const { data: result, error } = await rpc("get_crew_pairing_requests", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return managerFail(
        knownRaisedCode(MANAGER_RAISED, error.message) ?? "UNAVAILABLE",
        GENERIC_LIST_PAIRING,
      );
    }
    if (!Array.isArray(result)) return managerFail("UNAVAILABLE", GENERIC_LIST_PAIRING);
    const { decryptEnvelopeHex } = await import("./app-envelope-crypto.server");
    const requests: CrewPairingRequestRow[] = [];
    for (const item of result) {
      const row = item as Record<string, unknown> | null;
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.email !== "string" ||
        typeof row.full_name !== "string" ||
        typeof row.otp_encrypted !== "string" ||
        typeof row.created_at !== "string" ||
        typeof row.expires_at !== "string"
      ) {
        return managerFail("UNAVAILABLE", GENERIC_LIST_PAIRING);
      }
      const otp = decryptEnvelopeHex(row.otp_encrypted);
      if (!/^[0-9]{6}$/.test(otp)) return managerFail("UNAVAILABLE", GENERIC_LIST_PAIRING);
      requests.push({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        otp,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
      });
    }
    return { ok: true, requests };
  } catch {
    return managerFail("UNAVAILABLE", GENERIC_LIST_PAIRING);
  }
}

export const crewPairingList = createServerFn({ method: "POST" })
  .validator(crewPairingListInputSchema)
  .handler(async ({ data }): Promise<CrewPairingListResult> => {
    const rpc = managerClientFn(data.accessToken);
    if (!rpc) return managerFail("UNAVAILABLE", GENERIC_LIST_PAIRING);
    return crewPairingListCore({ managerToken: data.managerToken }, rpc);
  });

export type CrewVerdictResult =
  | { ok: true }
  | { ok: false; code: "INVALID_SESSION" | "NOT_FOUND" | "UNAVAILABLE"; message: string };

function readManagerVerdict(result: unknown, message: string): CrewVerdictResult {
  const raw = result as { ok?: unknown; error?: unknown } | null;
  if (raw?.ok === true) return { ok: true };
  if (raw && raw.error === "NOT_FOUND") {
    return { ok: false, code: "NOT_FOUND", message };
  }
  return { ok: false, code: "UNAVAILABLE", message };
}

export const crewPairingRejectInputSchema = z.object({
  accessToken: z.string().min(1),
  managerToken: z.string().min(1),
  requestId: z.string().uuid(),
});

export async function crewPairingRejectCore(
  data: { managerToken: string; requestId: string },
  rpc: RpcCaller,
): Promise<CrewVerdictResult> {
  try {
    const { data: result, error } = await rpc("reject_crew_pairing_request", {
      p_manager_token: data.managerToken,
      p_request_id: data.requestId,
    });
    if (error) {
      return managerFail(
        knownRaisedCode(MANAGER_RAISED, error.message) ?? "UNAVAILABLE",
        GENERIC_REJECT,
      );
    }
    return readManagerVerdict(result, GENERIC_REJECT);
  } catch {
    return managerFail("UNAVAILABLE", GENERIC_REJECT);
  }
}

export const crewPairingReject = createServerFn({ method: "POST" })
  .validator(crewPairingRejectInputSchema)
  .handler(async ({ data }): Promise<CrewVerdictResult> => {
    const rpc = managerClientFn(data.accessToken);
    if (!rpc) return managerFail("UNAVAILABLE", GENERIC_REJECT);
    return crewPairingRejectCore(
      { managerToken: data.managerToken, requestId: data.requestId },
      rpc,
    );
  });

export type CrewAccountRow = {
  authUid: string;
  email: string;
  fullName: string;
  status: string;
  pairedAt: string;
  hasActiveDevice: boolean;
  activeSessions: number;
};

export type CrewAccountListResult =
  | { ok: true; accounts: CrewAccountRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export const crewAccountListInputSchema = z.object({
  accessToken: z.string().min(1),
  managerToken: z.string().min(1),
});

export async function crewAccountListCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<CrewAccountListResult> {
  try {
    const { data: result, error } = await rpc("get_crew_accounts", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return managerFail(
        knownRaisedCode(MANAGER_RAISED, error.message) ?? "UNAVAILABLE",
        GENERIC_LIST_ACCOUNTS,
      );
    }
    if (!Array.isArray(result)) return managerFail("UNAVAILABLE", GENERIC_LIST_ACCOUNTS);
    const accounts: CrewAccountRow[] = [];
    for (const item of result) {
      const row = item as Record<string, unknown> | null;
      if (
        !row ||
        typeof row.auth_uid !== "string" ||
        typeof row.email !== "string" ||
        typeof row.full_name !== "string" ||
        typeof row.status !== "string" ||
        typeof row.paired_at !== "string" ||
        typeof row.has_active_device !== "boolean" ||
        typeof row.active_sessions !== "number"
      ) {
        return managerFail("UNAVAILABLE", GENERIC_LIST_ACCOUNTS);
      }
      accounts.push({
        authUid: row.auth_uid,
        email: row.email,
        fullName: row.full_name,
        status: row.status,
        pairedAt: row.paired_at,
        hasActiveDevice: row.has_active_device,
        activeSessions: row.active_sessions,
      });
    }
    return { ok: true, accounts };
  } catch {
    return managerFail("UNAVAILABLE", GENERIC_LIST_ACCOUNTS);
  }
}

export const crewAccountList = createServerFn({ method: "POST" })
  .validator(crewAccountListInputSchema)
  .handler(async ({ data }): Promise<CrewAccountListResult> => {
    const rpc = managerClientFn(data.accessToken);
    if (!rpc) return managerFail("UNAVAILABLE", GENERIC_LIST_ACCOUNTS);
    return crewAccountListCore({ managerToken: data.managerToken }, rpc);
  });

export const crewAccountResetInputSchema = z.object({
  accessToken: z.string().min(1),
  managerToken: z.string().min(1),
  authUid: z.string().uuid(),
});

export async function crewAccountResetCore(
  data: { managerToken: string; authUid: string },
  rpc: RpcCaller,
): Promise<CrewVerdictResult> {
  try {
    const { data: result, error } = await rpc("reset_crew_account", {
      p_manager_token: data.managerToken,
      p_auth_uid: data.authUid,
    });
    if (error) {
      return managerFail(
        knownRaisedCode(MANAGER_RAISED, error.message) ?? "UNAVAILABLE",
        GENERIC_RESET,
      );
    }
    return readManagerVerdict(result, GENERIC_RESET);
  } catch {
    return managerFail("UNAVAILABLE", GENERIC_RESET);
  }
}

export const crewAccountReset = createServerFn({ method: "POST" })
  .validator(crewAccountResetInputSchema)
  .handler(async ({ data }): Promise<CrewVerdictResult> => {
    const rpc = managerClientFn(data.accessToken);
    if (!rpc) return managerFail("UNAVAILABLE", GENERIC_RESET);
    return crewAccountResetCore({ managerToken: data.managerToken, authUid: data.authUid }, rpc);
  });

export const crewSessionsEndInputSchema = z.object({
  accessToken: z.string().min(1),
  managerToken: z.string().min(1),
  authUid: z.string().uuid(),
});

export async function crewSessionsEndCore(
  data: { managerToken: string; authUid: string },
  rpc: RpcCaller,
): Promise<CrewVerdictResult> {
  try {
    const { data: result, error } = await rpc("end_active_crew_sessions", {
      p_manager_token: data.managerToken,
      p_auth_uid: data.authUid,
    });
    if (error) {
      return managerFail(
        knownRaisedCode(MANAGER_RAISED, error.message) ?? "UNAVAILABLE",
        GENERIC_END_SESSIONS,
      );
    }
    return readManagerVerdict(result, GENERIC_END_SESSIONS);
  } catch {
    return managerFail("UNAVAILABLE", GENERIC_END_SESSIONS);
  }
}

export const crewSessionsEnd = createServerFn({ method: "POST" })
  .validator(crewSessionsEndInputSchema)
  .handler(async ({ data }): Promise<CrewVerdictResult> => {
    const rpc = managerClientFn(data.accessToken);
    if (!rpc) return managerFail("UNAVAILABLE", GENERIC_END_SESSIONS);
    return crewSessionsEndCore({ managerToken: data.managerToken, authUid: data.authUid }, rpc);
  });

// ---------------------------------------------------------------------------
// crewActivityList (Poin 5 G2): 30 aksi crew terakhir resto sang manager.
// ---------------------------------------------------------------------------

const GENERIC_LIST_ACTIVITY = "Gagal memuat riwayat aktivitas crew.";

export type CrewActivityRow = {
  createdAt: string;
  action: string;
  actorLabel: string | null;
  crewName: string;
};

export type CrewActivityListResult =
  | { ok: true; activities: CrewActivityRow[] }
  | { ok: false; code: "INVALID_SESSION" | "UNAVAILABLE"; message: string };

export const crewActivityListInputSchema = z.object({
  accessToken: z.string().min(1),
  managerToken: z.string().min(1),
});

export async function crewActivityListCore(
  data: { managerToken: string },
  rpc: RpcCaller,
): Promise<CrewActivityListResult> {
  try {
    const { data: result, error } = await rpc("get_crew_activity", {
      p_manager_token: data.managerToken,
    });
    if (error) {
      return managerFail(
        knownRaisedCode(MANAGER_RAISED, error.message) ?? "UNAVAILABLE",
        GENERIC_LIST_ACTIVITY,
      );
    }
    if (!Array.isArray(result)) return managerFail("UNAVAILABLE", GENERIC_LIST_ACTIVITY);
    const activities: CrewActivityRow[] = [];
    for (const item of result) {
      const row = item as Record<string, unknown> | null;
      if (
        !row ||
        typeof row.created_at !== "string" ||
        typeof row.action !== "string" ||
        typeof row.crew_name !== "string" ||
        !(row.actor_label === null || typeof row.actor_label === "string")
      ) {
        return managerFail("UNAVAILABLE", GENERIC_LIST_ACTIVITY);
      }
      activities.push({
        createdAt: row.created_at,
        action: row.action,
        actorLabel: (row.actor_label as string | null) ?? null,
        crewName: row.crew_name,
      });
    }
    return { ok: true, activities };
  } catch {
    return managerFail("UNAVAILABLE", GENERIC_LIST_ACTIVITY);
  }
}

export const crewActivityList = createServerFn({ method: "POST" })
  .validator(crewActivityListInputSchema)
  .handler(async ({ data }): Promise<CrewActivityListResult> => {
    const rpc = managerClientFn(data.accessToken);
    if (!rpc) return managerFail("UNAVAILABLE", GENERIC_LIST_ACTIVITY);
    return crewActivityListCore({ managerToken: data.managerToken }, rpc);
  });
