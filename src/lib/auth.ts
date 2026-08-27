import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type AuthStatus = { superAdmin: boolean };

export const loginInputSchema = z.object({
  password: z.string(),
  clientKey: z.string().min(16).max(200),
});

export function ownerLoginFailure() {
  return { ok: false as const, message: "Login gagal." };
}

/**
 * Kredensial HANYA dibaca dari environment variable.
 * Tidak ada nilai fallback yang di-hardcode: kalau env belum diset, login ditolak
 * (fail closed) alih-alih memakai password yang tertulis di dalam source.
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
    const { getAuthSession } = await import("./auth.server");
    const session = await getAuthSession();
    return {
      superAdmin: session.data.superAdmin === true,
    };
  },
);

export const loginSuperAdmin = createServerFn({ method: "POST" })
  .validator(loginInputSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const { isPasswordValid, updateAuthSession } = await import("./auth.server");
    const expectedPassword = readEnv("SUPER_ADMIN_PASSWORD");
    if (expectedPassword === null) return ownerLoginFailure();
    const { completeOwnerLoginAttempt, reserveOwnerLoginAttempt } =
      await import("./owner-login-rate-limit.server");
    const reservationId = await reserveOwnerLoginAttempt(data.clientKey);
    if (!reservationId) return ownerLoginFailure();

    let valid = false;
    try {
      valid = isPasswordValid(data.password, expectedPassword);
    } catch {
      valid = false;
    }
    if (!(await completeOwnerLoginAttempt(reservationId, valid))) return ownerLoginFailure();
    if (!valid) return ownerLoginFailure();
    await updateAuthSession({ superAdmin: true });
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAuthSession } = await import("./auth.server");
  await clearAuthSession();
  return { ok: true };
});
