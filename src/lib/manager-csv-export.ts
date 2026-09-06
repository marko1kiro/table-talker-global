import type { DailyStatsResult } from "./manager-stats.server";
import type { CrewHistoryRow } from "./manager-dashboard.server";

function peakLabel(hour: number | null): string {
  if (hour === null) return "-";
  return `${String(hour).padStart(2, "0")}:00 WIB`;
}

function avgLabel(min: number | null): string {
  if (min === null) return "-";
  return String(min);
}

export function buildManagerCsv(
  stats: DailyStatsResult & { ok: true },
  crew: CrewHistoryRow[],
  date: string,
): string {
  const lines: string[] = [];

  lines.push("Ringkasan Harian");
  lines.push("Tanggal,Total Tamu Dilayani,Rata-rata Durasi (menit),Peak Hour");
  lines.push(
    `${date},${stats.totalServed},${avgLabel(stats.avgDurationMinutes)},${peakLabel(stats.peakHour)}`,
  );
  lines.push("");

  lines.push("Occupancy Per Meja");
  lines.push("No Meja,Kali Terisi,Total Durasi (menit),Avg Durasi (menit)");
  for (const t of stats.perTable) {
    lines.push(`${t.tableNumber},${t.timesOccupied},${t.totalMinutes},${avgLabel(t.avgMinutes)}`);
  }
  lines.push("");

  lines.push("Crew History");
  lines.push("Role,Nama,Jam Masuk,Status");
  for (const c of crew) {
    lines.push(
      `${c.role},${c.displayName},${c.checkedInAt},${c.isActive ? "Aktif" : "Tidak Aktif"}`,
    );
  }

  return lines.join("\n");
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
