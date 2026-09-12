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
  /**
   * P1-3: persist the pending-handoff recovery record (exact bearer +
   * reservation) BEFORE any other browser-side work. Returns false when the
   * record could not be stored. A missing record is a hard pre-confirm
   * failure: without it a later submit re-enters a fresh login and surrenders
   * this newly minted pending bearer as its "old" credential.
   */
  persistPending: (identity: ManagerHandoffIdentity) => boolean;
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
  /** Read the authoritative DB state after confirm response loss/ambiguity. */
  reconcileHandoff: (
    managerToken: string,
    rateLimitReservationId: string,
  ) => Promise<"succeeded" | "pending" | "failed" | "unknown">;
  /** R5-A + R6-C: delete the pending session + bank the failure outcome. */
  cleanupPending: (managerToken: string, rateLimitReservationId: string) => Promise<void>;
  /**
   * P1-4: delete the freshly written browser identity. The core calls this ONLY
   * on a definitive post-write failure — after a successful pending cleanup or
   * an authoritative `failed` reconciliation — so a stale, never-confirmed
   * identity is never left usable. It is NEVER called on unresolved outcomes
   * (`reconciliation_unknown` / `cleanup_failed`) or on pre-write failures,
   * where no identity was ever successfully written.
   */
  removeIdentity: () => void;
};

export type ManagerHandoffResult =
  | { ok: true }
  | {
      ok: false;
      reason: "handoff_failed" | "cleanup_failed" | "reconciliation_unknown";
    };

export async function managerLoginHandoffCore(
  identity: ManagerHandoffIdentity,
  deps: ManagerHandoffDeps,
): Promise<ManagerHandoffResult> {
  // P1-4: identity removal is only legitimate AFTER a successful write. Every
  // pre-write failure (persistence, token, storage/write) leaves nothing written
  // to remove, so the flag gates cleanup's removal call.
  let identityWritten = false;

  // Reviewer finding (P1-4): browser-side removal is best-effort. Once the
  // server outcome is definitive, a storage throw here must never change the
  // verdict (no downgrade to cleanup_failed) nor escape as a rejection.
  const removeIdentityBestEffort = (): void => {
    try {
      deps.removeIdentity();
    } catch {
      // identity stays stale; route-level recovery remains the backstop
    }
  };

  const cleanup = async (): Promise<ManagerHandoffResult> => {
    try {
      await deps.cleanupPending(identity.managerToken, identity.rateLimitReservationId);
      if (identityWritten) removeIdentityBestEffort();
      return { ok: false, reason: "handoff_failed" };
    } catch {
      return { ok: false, reason: "cleanup_failed" };
    }
  };

  // P1-3: the recovery record comes first. If it cannot be persisted, this
  // handoff fails closed HERE with the exact pending cleanup — nothing is
  // written, navigated, or confirmed — so no later submit can present this
  // pending bearer to the mandatory old-credential revoker. The server-side
  // equality guard covers the case where storage lies about succeeding.
  let persisted = false;
  try {
    persisted = deps.persistPending(identity) === true;
  } catch {
    persisted = false;
  }
  if (!persisted) return cleanup();

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
    identityWritten = true;
  } catch {
    return cleanup();
  }

  try {
    await deps.navigate();
  } catch {
    return cleanup();
  }

  // Confirm AFTER identity write + navigate succeed. A false/throw may be a
  // lost or malformed response after the DB already committed, so retry the
  // exact token+reservation pair and then read authoritative state. Never run
  // compensation while activation is uncertain: cleanup cannot undo an active
  // session and would create a false failure in the browser.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (
        (await deps.confirmHandoff(identity.managerToken, identity.rateLimitReservationId)) === true
      ) {
        return { ok: true };
      }
    } catch {
      // Reconcile below after both bounded attempts.
    }
  }

  let reconciled: "succeeded" | "pending" | "failed" | "unknown" = "unknown";
  try {
    reconciled = await deps.reconcileHandoff(
      identity.managerToken,
      identity.rateLimitReservationId,
    );
  } catch {
    return { ok: false, reason: "reconciliation_unknown" };
  }
  if (reconciled === "succeeded") return { ok: true };
  // P1-4: authoritative `failed` is definitive — server already settled the
  // pending session, so cleanup would be a redundant no-op. Still drop the
  // stale browser identity so the next submit cannot present it.
  if (reconciled === "failed") {
    removeIdentityBestEffort();
    return { ok: false, reason: "handoff_failed" };
  }
  if (reconciled === "unknown") return { ok: false, reason: "reconciliation_unknown" };

  return cleanup();
}
