// Pure reminder logic for the manager dashboard. Reuses the proven client-side
// occupied-duration helpers from clear-up-queue.ts (zero server/DB cost). Only
// tables occupied MORE THAN 2 hours are surfaced; the caller rotates the list
// every 7s when there is more than one line.
import { formatOccupiedDuration, sortedOccupiedTables } from "./clear-up-queue";
import type { TableOccupancyRow } from "./table-occupancy.server";

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export function buildStaleReminders(tables: readonly TableOccupancyRow[], nowMs: number): string[] {
  return sortedOccupiedTables(tables, nowMs)
    .filter((entry) => entry.durationMs > TWO_HOURS_MS)
    .map(
      (entry) =>
        `MEJA ${entry.tableNumber} | >${formatOccupiedDuration(entry.durationMs).toUpperCase()} | PERLU DI CEK`,
    );
}

export function rotateIndex(length: number, tick: number): number {
  if (length <= 0) return 0;
  return ((tick % length) + length) % length;
}
