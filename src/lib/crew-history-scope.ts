import { format, parseISO } from "date-fns";
import { id as localeId } from "date-fns/locale";

export type CrewScope = { kind: "today" } | { kind: "date"; date: string } | { kind: "all" };

export function wibDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

export function scopeToParams(scope: CrewScope): { date?: string } {
  if (scope.kind === "all") return {};
  if (scope.kind === "date") return { date: scope.date };
  return { date: wibDateKey() };
}

export function scopeQueryKey(scope: CrewScope): string {
  if (scope.kind === "date") return scope.date;
  return scope.kind === "all" ? "all" : wibDateKey();
}

export function formatScopeDate(date: string): string {
  return format(parseISO(date), "EEE, d MMM yyyy", { locale: localeId });
}

export function crewEmptyText(scope: CrewScope): string {
  if (scope.kind === "all") return "Belum ada riwayat kehadiran.";
  if (scope.kind === "date") return "Belum ada crew check-in di tanggal ini.";
  return "Belum ada crew yang check-in hari ini.";
}
