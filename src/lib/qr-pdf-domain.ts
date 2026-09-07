export type DynamicQrRow = { tableNumber: number; token: string };

export const TOTAL_A2_SLOTS = 150;
export const A2_COLUMNS = 10;
export const A2_ROWS = 15;

export function buildA2QrSlots(rows: DynamicQrRow[]): DynamicQrRow[] {
  if (!rows.length) return [];
  const sorted = [...rows].sort((a, b) => a.tableNumber - b.tableNumber);
  const slots: DynamicQrRow[] = [];
  for (let i = 0; i < TOTAL_A2_SLOTS; i++) {
    slots.push(sorted[i % sorted.length]);
  }
  return slots;
}
