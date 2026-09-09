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
};

export type ManagerHandoffDeps = {
  ensureAccessToken: () => Promise<string | null>;
  getStorage: () => StorageLike | null;
  writeIdentity: (storage: StorageLike | null, identity: ManagerIdentity) => ManagerIdentity | null;
  setReminderFlag: () => void;
  navigate: () => Promise<void> | void;
  /** R5-A: atomically promote pending→active. true = session now active. */
  confirmHandoff: (managerToken: string) => Promise<boolean>;
  /** R5-A: delete the pending session (best-effort cleanup on failure). */
  cleanupPending: (managerToken: string) => Promise<void>;
};

export type ManagerHandoffResult = { ok: true } | { ok: false; reason: "handoff_failed" };

export async function managerLoginHandoffCore(
  identity: ManagerHandoffIdentity,
  deps: ManagerHandoffDeps,
): Promise<ManagerHandoffResult> {
  const cleanup = async (): Promise<ManagerHandoffResult> => {
    try {
      await deps.cleanupPending(identity.managerToken);
    } catch {
      // cleanup is best-effort; pending session expires via TTL regardless
    }
    return { ok: false, reason: "handoff_failed" };
  };

  const accessToken = await deps.ensureAccessToken().catch(() => null);
  if (!accessToken) return cleanup();

  try {
    deps.setReminderFlag();
  } catch {
    // cosmetic; never blocks the handoff
  }

  const written = deps.writeIdentity(deps.getStorage(), { ...identity, accessToken });
  if (!written) return cleanup();

  try {
    await deps.navigate();
  } catch {
    return cleanup();
  }

  // Confirm AFTER identity write + navigate succeed. If confirm fails,
  // the pending session is cleaned up — the browser never had a usable session.
  let confirmed = false;
  try {
    confirmed = (await deps.confirmHandoff(identity.managerToken)) === true;
  } catch {
    confirmed = false;
  }
  if (!confirmed) return cleanup();

  return { ok: true };
}
