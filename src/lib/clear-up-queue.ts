// Task 12: pure, framework-free logic for the Clear Up route's occupied-
// table queue. Kept separate from src/routes/clear-up/index.tsx so it can
// be unit-tested directly without a browser environment, matching this
// codebase's established pattern of extracting dependency-free logic into
// its own lib module (see satgas-escort-waitlist.ts,
// use-table-occupancy-realtime.ts's createTableOccupancyRealtimeController).
//
// Per the design spec, Clear Up's list is sorted/highlighted by occupied
// duration, computed entirely client-side from `occupied_at` (already
// part of every getTableOccupancySnapshot row) -- a plain
// `Date.now() - occupied_at` computation, zero additional server or DB
// cost. `sortedOccupiedTables` is a pure function of its `nowMs` argument
// (never reads the clock itself) so the route's 1-second `setInterval`
// tick can recompute this on every tick without any extra network call.
import type { TableOccupancyRow } from "./table-occupancy.server";

export type OccupiedTableEntry = TableOccupancyRow & { durationMs: number };

// Tables that have never been TERISI (status !== "terisi") never appear
// here, per spec. A TERISI row with a missing/malformed occupied_at is
// also excluded rather than crashing -- this should never happen in
// practice (the RPCs always set occupied_at when transitioning to
// terisi), but the queue must degrade safely rather than throw if it
// ever does.
export function sortedOccupiedTables(
  tables: readonly TableOccupancyRow[],
  nowMs: number,
): OccupiedTableEntry[] {
  const entries: OccupiedTableEntry[] = [];
  for (const table of tables) {
    if (table.status !== "terisi" || !table.occupiedAt) continue;
    const occupiedAtMs = new Date(table.occupiedAt).getTime();
    if (!Number.isFinite(occupiedAtMs)) continue;
    const durationMs = Math.max(0, nowMs - occupiedAtMs);
    entries.push({ ...table, durationMs });
  }
  return entries.sort((a, b) => b.durationMs - a.durationMs);
}

// Indonesian, human-friendly duration label for the badge next to each
// queued table. Deliberately coarse (whole minutes/hours only) -- this is
// a "how long has this table needed cleaning" indicator for staff, not a
// precise stopwatch.
export function formatOccupiedDuration(durationMs: number): string {
  const totalMinutes = Math.floor(Math.max(0, durationMs) / 60_000);
  if (totalMinutes < 1) return "Baru saja";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} menit`;
  if (minutes === 0) return `${hours} jam`;
  return `${hours} jam ${minutes} menit`;
}
