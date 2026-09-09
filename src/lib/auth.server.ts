import {
  clearSession,
  getSession,
  updateSession,
  type SessionConfig,
} from "@tanstack/react-start/server";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface TableTalkerSession {
  dashboard?: boolean;
  superAdmin?: boolean;
  /**
   * Set once an INDIVIDUAL Super Admin account logs in. A session carrying
   * only superAdmin=true (legacy shared-password era) is rejected by
   * requireSuperAdmin as soon as the bootstrap cutover happened.
   */
  superAdminAccountId?: string;
  superAdminSessionToken?: string;
  areaManagerAccountId?: string;
  areaManagerSessionToken?: string;
  superAdminReauthenticatedAt?: number;
}

/**
 * Secret sesi wajib datang dari AUTH_SECRET.
 * Di production, tidak ada fallback: server harus gagal keras daripada memakai
 * secret yang tertulis di source (siapa pun pemegang source bisa memalsukan cookie).
 * Di development, secret acak dibuat sekali per proses agar tetap mudah dijalankan.
 */
let devSessionSecret: string | null = null;

export function getAuthSecret(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (typeof fromEnv === "string" && fromEnv.length >= 32) return fromEnv;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "AUTH_SECRET belum diset (atau kurang dari 32 karakter). Setel di environment variables sebelum menjalankan production.",
    );
  }

  if (devSessionSecret === null) {
    devSessionSecret = randomBytes(32).toString("hex");
    console.warn(
      "[auth] AUTH_SECRET belum diset — memakai secret acak sementara untuk development. Sesi akan hilang tiap restart.",
    );
  }
  return devSessionSecret;
}

export function isPasswordValid(password: string, expectedPassword: string | null): boolean {
  if (expectedPassword === null) return false;
  const candidate = createHash("sha256").update(password).digest();
  const expected = createHash("sha256").update(expectedPassword).digest();
  return timingSafeEqual(candidate, expected);
}

export function getAuthSessionConfig(): SessionConfig {
  return {
    name: "table-talker-session",
    password: getAuthSecret(),
    maxAge: 60 * 60 * 12,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
  };
}

export function getAuthSession() {
  return getSession<TableTalkerSession>(getAuthSessionConfig());
}

export function updateAuthSession(update: Partial<TableTalkerSession>) {
  return updateSession<TableTalkerSession>(getAuthSessionConfig(), update);
}

export function clearAuthSession() {
  return clearSession(getAuthSessionConfig());
}

/**
 * Server-authoritative credential hygiene (review R3-A): read the staff
 * bearer tokens currently held by this browser's session cookie so a role
 * switch can revoke them BEFORE minting the replacement session.
 */
export async function readCookieStaffTokens(): Promise<{
  superAdminToken: string | null;
  areaManagerToken: string | null;
}> {
  const session = await getAuthSession();
  return {
    superAdminToken: session.data.superAdminSessionToken ?? null,
    areaManagerToken: session.data.areaManagerSessionToken ?? null,
  };
}

/**
 * Revokes exactly ONE staff session by its raw bearer token (the token acts
 * as its own revocation proof, like a logout endpoint). Scoped to a single
 * row — never all devices. Throws on transport failure so callers can fail
 * closed instead of leaving two usable credentials.
 */
export async function revokeStaffSessionByToken(
  kind: "super_admin" | "area_manager",
  token: string,
): Promise<void> {
  const { getServiceClient } = await import("./remote-audio.server");
  const client = getServiceClient();
  if (!client) throw new Error("UNAVAILABLE");
  const { error } = await client.rpc("revoke_staff_session_by_token", {
    p_kind: kind,
    p_token: token,
  });
  if (error) throw new Error("REVOKE_FAILED");
}

/** Same as revokeStaffSessionByToken for the manager bearer namespace. */
export async function revokeManagerSessionByToken(token: string): Promise<void> {
  const { getServiceClient } = await import("./remote-audio.server");
  const client = getServiceClient();
  if (!client) throw new Error("UNAVAILABLE");
  const { error } = await client.rpc("revoke_manager_session_by_token", {
    p_token: token,
  });
  if (error) throw new Error("REVOKE_FAILED");
}

export async function requireDashboard() {
  const session = await getAuthSession();
  if (session.data.dashboard !== true) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

type BootstrapState = { open: boolean; activeCount: number };

async function readBootstrapState(): Promise<BootstrapState | null> {
  const { getServiceClient } = await import("./remote-audio.server");
  const client = getServiceClient();
  if (!client) return null;
  const { data, error } = await client.rpc("bootstrap_super_admin_state");
  if (error || typeof data !== "object" || data === null) return null;
  const raw = data as { open?: unknown; active_count?: unknown };
  return {
    open: raw.open === true,
    activeCount: typeof raw.active_count === "number" ? raw.active_count : 0,
  };
}

/**
 * Maps a staff bearer token to its account id, or null when the token does
 * not live in staff_sessions. Exported for session-authoritative status
 * checks (review C12) — callers MUST compare the result to their own
 * account id, never trust the cookie alone.
 */
export async function staffSessionAccount(
  kind: "super_admin" | "area_manager",
  token: string,
): Promise<string | null> {
  const { getServiceClient } = await import("./remote-audio.server");
  const client = getServiceClient();
  if (!client) return null;
  try {
    const { data, error } = await client.rpc("get_staff_session", {
      p_kind: kind,
      p_token: token,
    });
    if (error || typeof data !== "string" || !data) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Authoritative Super Admin gate. Two valid states:
 *  1. Individual account session — the bearer token must still exist in
 *     staff_sessions (deactivation/password change revokes it) and map to
 *     the same account.
 *  2. Legacy shared-password session — only honored while the one-time
 *     bootstrap gate is still open and no individual account is active.
 * After the cutover, legacy cookies can never reach privileged actions.
 */
export async function requireSuperAdmin() {
  const session = await getAuthSession();
  if (session.data.superAdmin !== true) {
    throw new Error("UNAUTHORIZED");
  }
  const accountId = session.data.superAdminAccountId;
  const token = session.data.superAdminSessionToken;
  if (accountId && token) {
    const live = await staffSessionAccount("super_admin", token);
    if (live !== accountId) throw new Error("UNAUTHORIZED");
    return session;
  }
  const state = await readBootstrapState();
  if (!state || !state.open || state.activeCount > 0) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

/**
 * Authoritative Area Manager gate: bearer token must still live in
 * staff_sessions and the AM account must be active. Scope checks for a
 * specific restaurant always go through actor_can_manage_restaurant RPC.
 */
export async function requireAreaManager() {
  const session = await getAuthSession();
  const accountId = session.data.areaManagerAccountId;
  const token = session.data.areaManagerSessionToken;
  if (!accountId || !token) throw new Error("UNAUTHORIZED");
  const live = await staffSessionAccount("area_manager", token);
  if (live !== accountId) throw new Error("UNAUTHORIZED");
  return session;
}

/**
 * Reauthentication decision core (review B13). For an INDIVIDUAL Super Admin
 * session the submitted password must verify against THAT account's scrypt
 * hash — never the shared legacy env password. The shared SUPER_ADMIN_PASSWORD
 * path exists only for legacy sessions during the bootstrap era (which
 * requireSuperAdmin already restricts to "gate open, no active individual").
 */
export async function superAdminReauthCore(
  password: string,
  mode: "individual" | "legacy",
  stored: { individualHash: string | null; legacyPassword: string | null },
  verify: (password: string, stored: string) => Promise<boolean> = verifyManagerPasswordStatic,
): Promise<boolean> {
  if (mode === "individual") {
    if (!stored.individualHash) return false;
    return verify(password, stored.individualHash).catch(() => false);
  }
  try {
    return isPasswordValid(password, stored.legacyPassword);
  } catch {
    return false;
  }
}

async function verifyManagerPasswordStatic(password: string, stored: string): Promise<boolean> {
  const { verifyManagerPassword } = await import("./manager-password.server");
  return verifyManagerPassword(password, stored);
}

/**
 * Danger-operation reauthentication, bound to the CURRENT session identity:
 *  - individual session -> the linked Super Admin account's password;
 *  - legacy session -> SUPER_ADMIN_PASSWORD, only while requireSuperAdmin still
 *    honors the bootstrap era.
 * A 5-minute window is granted per session after a successful check.
 */
export async function requireRecentSuperAdmin(password: string) {
  const session = await requireSuperAdmin();
  const now = Date.now();
  if (
    session.data.superAdminReauthenticatedAt &&
    now - session.data.superAdminReauthenticatedAt <= 5 * 60 * 1000
  ) {
    return;
  }
  const accountId = session.data.superAdminAccountId;
  const token = session.data.superAdminSessionToken;
  let ok = false;
  if (accountId && token) {
    const { getServiceClient } = await import("./remote-audio.server");
    const client = getServiceClient();
    const cred = client
      ? ((await client.rpc("get_super_admin_credential_by_id", { p_account_id: accountId }))
          .data as { password_hash: string | null } | null)
      : null;
    ok = await superAdminReauthCore(password, "individual", {
      individualHash: cred?.password_hash ?? null,
      legacyPassword: null,
    });
  } else {
    ok = await superAdminReauthCore(password, "legacy", {
      individualHash: null,
      legacyPassword: process.env.SUPER_ADMIN_PASSWORD ?? null,
    });
  }
  if (!ok) throw new Error("UNAUTHORIZED");
  await updateAuthSession({ superAdminReauthenticatedAt: now });
}
