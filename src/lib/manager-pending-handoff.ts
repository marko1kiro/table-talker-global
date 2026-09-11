import type { StorageLike } from "./manager-session-identity";
import type { ManagerHandoffIdentity } from "./manager-login-handoff";

// Kept separately from the usable manager identity.  It exists only while a
// pending->active confirmation is uncertain, so a form re-submit can resume
// that exact pair instead of presenting the newly minted pending bearer as an
// "old" credential to mandatory role-switch revocation.
const PENDING_HANDOFF_KEY = "table-talker.manager-pending-handoff";

const REQUIRED_KEYS = [
  "idManager",
  "fullName",
  "restaurantId",
  "restaurantDisplayName",
  "restaurantCode",
  "managerToken",
  "rateLimitReservationId",
] as const;

export function readPendingManagerHandoff(storage: StorageLike | null): ManagerHandoffIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_HANDOFF_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (REQUIRED_KEYS.some((key) => typeof value[key] !== "string" || !value[key])) {
      storage.removeItem(PENDING_HANDOFF_KEY);
      return null;
    }
    return value as unknown as ManagerHandoffIdentity;
  } catch {
    try {
      storage.removeItem(PENDING_HANDOFF_KEY);
    } catch {
      // Storage is unavailable; the next login cannot safely recover it.
    }
    return null;
  }
}

export function writePendingManagerHandoff(
  storage: StorageLike | null,
  handoff: ManagerHandoffIdentity,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PENDING_HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function removePendingManagerHandoff(storage: StorageLike | null): void {
  try {
    storage?.removeItem(PENDING_HANDOFF_KEY);
  } catch {
    // Best effort only; server lifecycle decisions remain authoritative.
  }
}
