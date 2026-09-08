// Shared staff-ID rules for the single global namespace spanning
// super_admin / area_manager / manager. Normalization is canonical:
// trim + lowercase. The same regex is enforced authoritatively in the
// database (staff_id_registry + table CHECKs); these helpers mirror it so
// invalid input is rejected before any RPC call.
export const STAFF_ID_PATTERN = /^[a-z0-9._-]{3,32}$/;

export function normalizeStaffId(raw: string): string {
  return raw.trim().toLowerCase();
}

export function staffIdIsValid(raw: string): boolean {
  return STAFF_ID_PATTERN.test(normalizeStaffId(raw));
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function emailIsValid(raw: string): boolean {
  const email = normalizeEmail(raw);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 200;
}

export function staffPasswordIsValid(password: string): boolean {
  return password.length >= 8 && password.length <= 200;
}

export type StaffKind = "super_admin" | "area_manager" | "manager";

// Single generic failure message for every public auth surface: never reveals
// whether an ID/email exists, is pending, or is disabled.
export const GENERIC_AUTH_FAILURE = "Login gagal. Periksa kembali ID dan password.";
