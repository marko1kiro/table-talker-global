import { createServerFn } from "@tanstack/react-start";

export type AuthStatus = { dashboard: boolean; superAdmin: boolean };

type LoginInput = {
  password: string;
};

const MISCONFIGURED_MESSAGE = "Konfigurasi server belum lengkap. Hubungi administrator.";

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
      dashboard: session.data.dashboard === true,
      superAdmin: session.data.superAdmin === true,
    };
  },
);

export const login = createServerFn({ method: "POST" })
  .inputValidator((data: LoginInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const { isPasswordValid, updateAuthSession } = await import("./auth.server");

    const expectedPassword = readEnv("DASHBOARD_PASSWORD");
    if (expectedPassword === null) {
      return { ok: false, message: MISCONFIGURED_MESSAGE };
    }
    if (!isPasswordValid(data.password, expectedPassword)) {
      return { ok: false, message: "Password salah." };
    }
    await updateAuthSession({ dashboard: true });
    return { ok: true };
  });

export const loginSuperAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: LoginInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const { isPasswordValid, updateAuthSession } = await import("./auth.server");
    const expectedPassword = readEnv("SUPER_ADMIN_PASSWORD");
    if (!isPasswordValid(data.password, expectedPassword)) {
      return {
        ok: false,
        message: expectedPassword === null ? MISCONFIGURED_MESSAGE : "Password Super Admin salah.",
      };
    }
    await updateAuthSession({ superAdmin: true });
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAuthSession } = await import("./auth.server");
  await clearAuthSession();
  return { ok: true };
});
