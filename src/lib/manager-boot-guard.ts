// Poin 3 fix: /manager boot guard. The manager login handoff core navigates to
// the dashboard BEFORE confirmHandoff resolves (Poin 2 order, pinned by tests),
// so the dashboard mounts while the pending→active recovery record still
// exists. The pre-fix guard treated ANY record as a P1-4 corpse and wiped the
// fresh identity, bouncing every login whose confirm outlasted the route mount
// (deterministic since carrier sign-in made the handoff slower).
//
// Contract kept (P1-4): a lingering record still means the co-existing identity
// was never confirmed, so it must never be trusted. The difference is timing:
// a record whose bearer MATCHES the stored identity is usually THIS tab's
// in-flight handoff, so wait a bounded grace window for its owner to settle it
// (the owner clears the record only on a definitive verdict). Anything else —
// no identity, a foreign bearer, or a corpse that never settles — bounces to
// /manager/login exactly like before, leaving the record for the next submit.
import {
  readManagerIdentity,
  type ManagerIdentity,
  type StorageLike,
} from "./manager-session-identity";
import { readPendingManagerHandoff } from "./manager-pending-handoff";

export type ManagerBootOutcome = {
  /** Identity the dashboard may hydrate, or null to bounce to the login page. */
  identity: ManagerIdentity | null;
  /** True only when the co-existing identity is untrusted and must be dropped. */
  removeIdentity: boolean;
};

export type ManagerBootDeps = {
  wait: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxAttempts?: number;
};

export async function bootManagerDashboard(
  storage: StorageLike | null,
  deps: ManagerBootDeps,
): Promise<ManagerBootOutcome> {
  const stored = readManagerIdentity(storage);
  const pending = readPendingManagerHandoff(storage);
  if (!pending) {
    return { identity: stored ?? null, removeIdentity: false };
  }
  if (!stored || pending.managerToken !== stored.managerToken) {
    return { identity: null, removeIdentity: true };
  }
  const intervalMs = deps.intervalMs ?? 400;
  const maxAttempts = deps.maxAttempts ?? 12;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await deps.wait(intervalMs);
    if (!readPendingManagerHandoff(storage)) {
      // The handoff owner retires the record only on a definitive verdict:
      // ok (identity usable) or handoff_failed (identity already removed).
      const fresh = readManagerIdentity(storage);
      return { identity: fresh ?? null, removeIdentity: false };
    }
  }
  return { identity: null, removeIdentity: true };
}
