export function rankRestos<T extends { name: string; guests: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.guests - a.guests || a.name.localeCompare(b.name, "id"));
}
