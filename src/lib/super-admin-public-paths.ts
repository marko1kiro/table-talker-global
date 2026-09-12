/**
 * Public child routes of the Super Admin console (review A4): the emailed
 * one-time activation link and the recovery page MUST open without a session.
 * Their actions are token-verified server-side; every other /super-admin/*
 * child stays behind the AuthGate + the authoritative server gate.
 */
export const PUBLIC_SUPER_ADMIN_PATHS = ["/super-admin/accept", "/super-admin/recovery"] as const;

export function isPublicSuperAdminPath(pathname: string): boolean {
  return PUBLIC_SUPER_ADMIN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
