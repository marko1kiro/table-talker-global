export function filterManagersByResto<T extends { restaurant_id: string }>(
  rows: T[],
  restoId: string | null,
): T[] {
  if (!restoId) return rows;
  return rows.filter((r) => r.restaurant_id === restoId);
}
