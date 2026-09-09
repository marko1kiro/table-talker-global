import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { GENERIC_AUTH_FAILURE } from "./staff-identity.server";

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
  action: (report: (valid: boolean) => Promise<boolean>) => Promise<T>,
  onFailure: () => T,
): Promise<T> {
  const { reserveOwnerLoginAttempt, completeOwnerLoginAttempt } =
    await import("./owner-login-rate-limit.server");
  const reservationId = await reserveOwnerLoginAttempt(clientKey);
  if (!reservationId) return onFailure();
  try {
    return await action((valid) => completeOwnerLoginAttempt(reservationId, valid));
  } catch {
    return onFailure();
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
    const { isPasswordValid, updateAuthSession } = await import("./auth.server");
    const { getServiceClient } = await import("./remote-audio.server");
    const { verifyManagerPassword } = await import("./manager-password.server");
    const { normalizeStaffId } = await import("./staff-identity.server");
    const client = getServiceClient();
    if (!client) return ownerLoginFailure();

    if (data.mode === "legacy") {
      const expectedPassword = readEnv("SUPER_ADMIN_PASSWORD");
      if (expectedPassword === null) return ownerLoginFailure();
      return withLoginRateLimit(
        data.clientKey,
        async (report) => {
          let valid = false;
          try {
            valid = isPasswordValid(data.password, expectedPassword);
          } catch {
            valid = false;
          }
          if (!(await report(valid))) return ownerLoginFailure();
          if (!valid) return ownerLoginFailure();
          const { data: state, error } = await client.rpc("bootstrap_super_admin_state");
          const raw = state as { open?: boolean; active_count?: number } | null;
          if (error || !raw || raw.open !== true || (raw.active_count ?? 0) > 0) {
            return ownerLoginFailure();
          }
          await updateAuthSession({ superAdmin: true });
          return { ok: true as const };
        },
        ownerLoginFailure,
      );
    }

    if (!data.staffId) return ownerLoginFailure();
    const staffId = normalizeStaffId(data.staffId);
    return withLoginRateLimit(
      data.clientKey,
      async (report) => {
        const { data: cred, error } = await client.rpc("get_super_admin_credential", {
          p_staff_id: staffId,
        });
        const c = cred as { id: string; password_hash: string | null; status: string } | null;
        let valid = false;
        let accountId: string | null = null;
        if (!error && c && typeof c === "object" && c.status === "aktif" && c.password_hash) {
          valid = await verifyManagerPassword(data.password, c.password_hash).catch(() => false);
          accountId = c.id;
        }
        if (!(await report(valid))) return ownerLoginFailure();
        if (!valid || !accountId) return ownerLoginFailure();
        const { data: token, error: sessionError } = await client.rpc("create_staff_session", {
          p_kind: "super_admin",
          p_account_id: accountId,
        });
        if (sessionError || typeof token !== "string" || !token) return ownerLoginFailure();
        await updateAuthSession({
          superAdmin: true,
          superAdminAccountId: accountId,
          superAdminSessionToken: token,
          superAdminReauthenticatedAt: undefined,
        });
        return { ok: true as const };
      },
      ownerLoginFailure,
    );
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAuthSession } = await import("./auth.server");
  await clearAuthSession();
  return { ok: true };
});
