// Pure stale-table logic for the manager dashboard. Reuses the proven
// client-side occupied-duration helpers from clear-up-queue.ts (zero server/DB
// cost). Only tables occupied MORE THAN 2 hours are surfaced, as structured
// items consumed by the header NotificationBell.
import { formatOccupiedDuration, sortedOccupiedTables } from "./clear-up-queue";
import type { TableOccupancyRow } from "./table-occupancy.server";

export const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

export type StaleNotice = { table: number; duration: string };

export function buildStaleNotices(
  tables: readonly TableOccupancyRow[],
  nowMs: number,
): StaleNotice[] {
  return sortedOccupiedTables(tables, nowMs)
    .filter((entry) => entry.durationMs > TWO_HOURS_MS)
    .map((entry) => ({
      table: entry.tableNumber,
      duration: formatOccupiedDuration(entry.durationMs).toUpperCase(),
    }));
}
