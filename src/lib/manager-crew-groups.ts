// Pure grouping for the manager "CREW AKTIF" view: bucket active crew by
// station in a fixed display order, and format the check-in instant as a
// WIB wall-clock string. No server/DB work; operates on getManagerActiveCrew rows.
import type { ActiveCrewRow } from "./manager-dashboard.server";

const STATIONS: { role: string; label: string }[] = [
  { role: "ss", label: "SELF SERVICE" },
  { role: "kasir", label: "KASIR" },
  { role: "satgas", label: "SATGAS" },
  { role: "clear_up", label: "CLEAR UP" },
];

export type CrewStationGroup = { label: string; members: ActiveCrewRow[] };

export function groupActiveCrewByStation(rows: readonly ActiveCrewRow[]): CrewStationGroup[] {
  return STATIONS.map(({ role, label }) => ({
    label,
    members: rows.filter((r) => r.role === role),
  }));
}

export function formatWibClock(iso: string): string {
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "--:--:-- WIB";
  const wib = new Date(ms + 7 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(wib.getUTCHours())}:${p(wib.getUTCMinutes())}:${p(wib.getUTCSeconds())} WIB`;
}
