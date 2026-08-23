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

export async function requireDashboard() {
  const session = await getAuthSession();
  if (session.data.dashboard !== true) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}

export async function requireSuperAdmin() {
  const session = await getAuthSession();
  if (session.data.superAdmin !== true) {
    throw new Error("UNAUTHORIZED");
  }
  return session;
}
