// R4-A (round 4 review): the server mints the manager session BEFORE the
// browser can prove it obtained a usable identity. Every post-mint failure
// (anon access token, storage write, navigation) MUST revoke the freshly
// minted session through the server, or an active orphan row survives. The
// revocation is the compensation — deleting sessionStorage is NOT revocation.
// Compensation is idempotent (token-scoped: never touches other devices) and
// a failed compensation still fails closed (no navigation).
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
  /** Server-side idempotent revocation; true = server proved the token unusable. */
  revokeCompensation: (managerToken: string) => Promise<boolean>;
};

export type ManagerHandoffResult =
  | { ok: true }
  | { ok: false; reason: "handoff_failed" | "compensation_failed" };

export async function managerLoginHandoffCore(
  identity: ManagerHandoffIdentity,
  deps: ManagerHandoffDeps,
): Promise<ManagerHandoffResult> {
  // The raw manager token travels only inside this POST body — never a URL,
  // log, analytics payload, or error report.
  const compensate = async (): Promise<ManagerHandoffResult> => {
    let confirmed = false;
    try {
      confirmed = (await deps.revokeCompensation(identity.managerToken)) === true;
    } catch {
      confirmed = false;
    }
    return confirmed
      ? { ok: false, reason: "handoff_failed" }
      : { ok: false, reason: "compensation_failed" };
  };

  const accessToken = await deps.ensureAccessToken().catch(() => null);
  if (!accessToken) return compensate();

  try {
    deps.setReminderFlag();
  } catch {
    // the reminder flag is cosmetic; it never blocks the handoff
  }

  const written = deps.writeIdentity(deps.getStorage(), { ...identity, accessToken });
  if (!written) return compensate();

  try {
    await deps.navigate();
  } catch {
    return compensate();
  }
  return { ok: true };
}
