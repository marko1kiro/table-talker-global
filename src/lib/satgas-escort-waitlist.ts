// Task 11: pure, framework-free helpers backing the Satgas Escort Intent
// flow's client-side 10-minute confirm prompt. Kept separate from
// src/routes/satgas/index.tsx (mirroring the crew-session-identity.ts /
// use-layout-preference.ts split elsewhere in this codebase) so the
// storage scoping and expiry logic can be unit-tested without a React
// tree, and so this module never imports a *.server.ts file.
//
// Design note (see docs/superpowers/plans/2026-08-29-table-occupancy-
// tracking.md, Task 11 breakdown): the plan text originally imagined
// escort intents riding along in get_table_occupancy_snapshot's response,
// but that RPC's contract (Task 6, already shipped and covered by
// tests/table-occupancy-rpc-contract.test.ts) never included them.
// Rather than touch that RPC, each intent's id/table/expiry is tracked
// entirely client-side, scoped to the role_session_id that created it via
// the storage key below -- this satisfies the spec's isolation
// requirement for free: a different Satgas session (or the same device
// after a fresh login creates a new role_session_id) reads a different
// key and so can never see another session's pending intent.

export type EscortWaitEntry = {
  intentId: string;
  tableNumber: number;
  // Client-estimated epoch ms mirroring the create_escort_intent RPC's
  // server-side 10-minute expiry -- used only to decide *when to show* the
  // confirm prompt on this device. confirm_escort_intent's own
  // INTENT_NOT_FOUND response (checked server-side, against the server's
  // clock) remains the sole authority on whether the intent has actually
  // expired.
  expiresAt: number;
};

// The RPC (originally supabase/migrations/20260829020000_table_occupancy_rpcs.sql,
// shortened by supabase/migrations/20260902000000_escort_intent_10_minute_window.sql,
// create_escort_intent) sets `expires_at = now() + interval '10 minutes'`.
export const ESCORT_INTENT_WINDOW_MS = 10 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ESCORT_WAITLIST_KEY_PREFIX = "table-talker.satgas-escort-waitlist.";

export function escortWaitlistStorageKey(roleSessionId: string): string {
  return `${ESCORT_WAITLIST_KEY_PREFIX}${roleSessionId}`;
}

function isEscortWaitEntry(value: unknown): value is EscortWaitEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.intentId === "string" &&
    typeof v.tableNumber === "number" &&
    typeof v.expiresAt === "number"
  );
}

export function readEscortWaitlist(
  storage: StorageLike | null,
  roleSessionId: string,
): EscortWaitEntry[] {
  if (!storage || !roleSessionId) return [];
  const key = escortWaitlistStorageKey(roleSessionId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("escort waitlist is not an array");
    return parsed.filter(isEscortWaitEntry);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage unavailable -- nothing more we can do; fail open below.
    }
    return [];
  }
}

export function writeEscortWaitlist(
  storage: StorageLike | null,
  roleSessionId: string,
  entries: EscortWaitEntry[],
): void {
  if (!storage || !roleSessionId) return;
  try {
    storage.setItem(escortWaitlistStorageKey(roleSessionId), JSON.stringify(entries));
  } catch {
    // Storage unavailable/blocked (e.g. private browsing) -- silently drop,
    // matching this codebase's established fail-open storage pattern.
  }
}

export function addEscortWaitEntry(
  storage: StorageLike | null,
  roleSessionId: string,
  entry: EscortWaitEntry,
): EscortWaitEntry[] {
  const next = [
    ...readEscortWaitlist(storage, roleSessionId).filter((e) => e.intentId !== entry.intentId),
    entry,
  ];
  writeEscortWaitlist(storage, roleSessionId, next);
  return next;
}

export function removeEscortWaitEntry(
  storage: StorageLike | null,
  roleSessionId: string,
  intentId: string,
): EscortWaitEntry[] {
  const next = readEscortWaitlist(storage, roleSessionId).filter((e) => e.intentId !== intentId);
  writeEscortWaitlist(storage, roleSessionId, next);
  return next;
}

// Minimal shape this module needs from a TableOccupancyRow -- kept local
// (rather than importing the type from table-occupancy.server.ts) so this
// client-safe module never has a static import from a *.server.ts file.
export type OccupancyStatusRow = { tableNumber: number; status: "kosong" | "terisi" };

export type EscortWaitlistPartition = {
  readyToConfirm: EscortWaitEntry[];
  stillWaiting: EscortWaitEntry[];
  autoCleared: EscortWaitEntry[];
};

function statusFor(tables: OccupancyStatusRow[], tableNumber: number): "kosong" | "terisi" {
  return tables.find((table) => table.tableNumber === tableNumber)?.status ?? "kosong";
}

// Splits the current waitlist into three buckets against the latest
// snapshot + the current clock, per the spec:
// - autoCleared: the table is already terisi (resolved by a QR scan,
//   Kasir, or anyone else) -- disappears with no prompt, checked first so
//   it always wins over the window having also elapsed.
// - readyToConfirm: still kosong, and the 30-minute window has elapsed --
//   show the Konfirmasi prompt.
// - stillWaiting: still kosong, window not yet elapsed -- no UI shown.
export function partitionEscortWaitlist(
  entries: EscortWaitEntry[],
  tables: OccupancyStatusRow[],
  now: number,
): EscortWaitlistPartition {
  const readyToConfirm: EscortWaitEntry[] = [];
  const stillWaiting: EscortWaitEntry[] = [];
  const autoCleared: EscortWaitEntry[] = [];
  for (const entry of entries) {
    if (statusFor(tables, entry.tableNumber) === "terisi") {
      autoCleared.push(entry);
    } else if (now >= entry.expiresAt) {
      readyToConfirm.push(entry);
    } else {
      stillWaiting.push(entry);
    }
  }
  return { readyToConfirm, stillWaiting, autoCleared };
}
