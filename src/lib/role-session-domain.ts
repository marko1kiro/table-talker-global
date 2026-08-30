// Pure, framework-free helpers for the Task 8 revised login flow. Kept
// separate from role-session.server.ts (which owns the server-only
// claim_role_session RPC wiring) so RoleLoginFlow.tsx's role picker and
// manual date/time input can import plain, client-safe logic without
// pulling in a *.server.ts module (which bundles node:crypto and is
// tree-shaken into a server-only chunk unusable from client code).
//
// CREW_ROLES/CrewRole are the canonical source of truth here;
// role-session.server.ts re-exports them for backward compatibility with
// existing Task 6 imports rather than the other way around.
export const CREW_ROLES = ["ss", "kasir", "satgas", "clear_up"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

// Display order for the 4-button role picker, per the spec's
// "[SS] [Kasir] [Satgas] [Clear Up]" sequence.
export const CREW_ROLE_ORDER: readonly CrewRole[] = CREW_ROLES;

export const CREW_ROLE_LABELS: Record<CrewRole, string> = {
  ss: "SS",
  kasir: "Kasir",
  satgas: "Satgas",
  clear_up: "Clear Up",
};

const DATETIME_LOCAL_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

// Converts an HTML <input type="datetime-local"> value (which carries no
// timezone information) into a UTC ISO timestamp, interpreting the wall
// clock as Asia/Jakarta (UTC+7, no DST) per the design spec's "Tanggal &
// Jam Masuk" field. Returns null for empty/malformed input rather than
// throwing, so RoleLoginFlow can surface a validation error instead of
// crashing on an unparsable manually-typed value.
export function jakartaCheckedInAtToIso(value: string): string | null {
  const match = DATETIME_LOCAL_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = second ? Number(second) : 0;
  // Reject out-of-range calendar/clock fields up front -- Date.UTC would
  // otherwise silently normalize them (e.g. month 13 rolling into next
  // year) instead of signaling an invalid manually-typed value.
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  // WIB is UTC+7 with no daylight saving, so subtracting 7 hours from the
  // wall-clock value (treated as if it were UTC) yields the true UTC instant.
  const utcMs = Date.UTC(y, mo - 1, d, h - 7, mi, s);
  if (Number.isNaN(utcMs)) return null;
  return new Date(utcMs).toISOString();
}
