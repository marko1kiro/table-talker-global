import { createServerFn } from "@tanstack/react-start";

export type AuthRole = "dashboard" | "manage";
export type AuthStatus = { dashboard: boolean; manage: boolean };

type LoginInput = {
  role: AuthRole;
  username?: string;
  password: string;
};

const MISCONFIGURED_MESSAGE =
  "Konfigurasi server belum lengkap. Hubungi administrator.";

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

/** Perbandingan waktu-konstan sederhana untuk mengurangi kebocoran lewat timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const getAuthStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthStatus> => {
    const { getAuthSession } = await import("./auth.server");
    const session = await getAuthSession();
    return {
      dashboard: session.data.dashboard === true || session.data.manage === true,
      manage: session.data.manage === true,
    };
  },
);

export const login = createServerFn({ method: "POST" })
  .inputValidator((data: LoginInput) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; message?: string }> => {
    const { updateAuthSession } = await import("./auth.server");

    if (data.role === "manage") {
      const expectedUsername = readEnv("MANAGE_USERNAME");
      const expectedPassword = readEnv("MANAGE_PASSWORD");
      if (expectedUsername === null || expectedPassword === null) {
        return { ok: false, message: MISCONFIGURED_MESSAGE };
      }
      if (
        !safeEqual(data.username ?? "", expectedUsername) ||
        !safeEqual(data.password, expectedPassword)
      ) {
        return { ok: false, message: "Username atau password salah." };
      }
      await updateAuthSession({ dashboard: true, manage: true });
      return { ok: true };
    }

    const expectedPassword = readEnv("DASHBOARD_PASSWORD");
    if (expectedPassword === null) {
      return { ok: false, message: MISCONFIGURED_MESSAGE };
    }
    if (!safeEqual(data.password, expectedPassword)) {
      return { ok: false, message: "Password salah." };
    }
    await updateAuthSession({ dashboard: true });
    return { ok: true };
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const { clearAuthSession } = await import("./auth.server");
  await clearAuthSession();
  return { ok: true };
});
