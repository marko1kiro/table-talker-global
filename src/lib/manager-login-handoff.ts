// R5-A (round 5 review): pending→active handshake. The server mints a PENDING
// session (not yet usable by dashboard, RPC, realtime, or authorization).
// The browser proves it can store the identity, then calls confirmHandoff to
// atomically promote pending→active. Every pre-confirmation failure cleans up
// the pending session, leaving zero active sessions.
import type { ManagerIdentity, StorageLike } from "./manager-session-identity";

export type ManagerHandoffIdentity = {
  idManager: string;
  fullName: string;
  restaurantId: string;
  restaurantDisplayName: string;
  restaurantCode: string;
  managerToken: string;
  /** R6-C: the rate-limit reservation finalized by confirm/cleanup. */
  rateLimitReservationId: string;
};

export type ManagerHandoffDeps = {
  ensureAccessToken: () => Promise<string | null>;
  getStorage: () => StorageLike | null;
  writeIdentity: (storage: StorageLike | null, identity: ManagerIdentity) => ManagerIdentity | null;
  setReminderFlag: () => void;
  navigate: () => Promise<void> | void;
  /**
   * R5-A + R6-C: atomically promote pending→active AND bank the rate-limit
   * success in one DB transaction. true = session now active and outcome final.
   */
  confirmHandoff: (managerToken: string, rateLimitReservationId: string) => Promise<boolean>;
  /** R5-A + R6-C: delete the pending session + bank the failure outcome. */
  cleanupPending: (managerToken: string, rateLimitReservationId: string) => Promise<void>;
};

export type ManagerHandoffResult =
  | { ok: true }
  | { ok: false; reason: "handoff_failed" | "cleanup_failed" };

export async function managerLoginHandoffCore(
  identity: ManagerHandoffIdentity,
  deps: ManagerHandoffDeps,
): Promise<ManagerHandoffResult> {
  const cleanup = async (): Promise<ManagerHandoffResult> => {
    try {
      await deps.cleanupPending(identity.managerToken, identity.rateLimitReservationId);
      return { ok: false, reason: "handoff_failed" };
    } catch {
      return { ok: false, reason: "cleanup_failed" };
    }
  };

  const accessToken = await deps.ensureAccessToken().catch(() => null);
  if (!accessToken) return cleanup();

  try {
    deps.setReminderFlag();
  } catch {
    // cosmetic; never blocks the handoff
  }

  let storage: StorageLike | null;
  try {
    storage = deps.getStorage();
    const written = deps.writeIdentity(storage, { ...identity, accessToken });
    if (!written) return cleanup();
  } catch {
    return cleanup();
  }

  try {
    await deps.navigate();
  } catch {
    return cleanup();
  }

  // Confirm AFTER identity write + navigate succeed. If confirm fails,
  // the pending session is cleaned up — the browser never had a usable session.
  let confirmed = false;
  for (let attempt = 0; attempt < 2 && !confirmed; attempt += 1) {
    try {
      confirmed =
        (await deps.confirmHandoff(identity.managerToken, identity.rateLimitReservationId)) === true;
    } catch {
      confirmed = false;
    }
  }
  if (!confirmed) return cleanup();

  return { ok: true };
}
