import { describe, expect, it } from "vitest";
import { buildA2QrSlots, TOTAL_A2_SLOTS } from "../src/lib/qr-pdf-domain";

describe("buildA2QrSlots", () => {
  it("creates exactly 150 slots", () => {
    const rows = [
      { tableNumber: 1, token: "t1" },
      { tableNumber: 2, token: "t2" },
    ];
    const slots = buildA2QrSlots(rows);
    expect(slots.length).toBe(TOTAL_A2_SLOTS);
    expect(slots.length).toBe(150);
  });

  it("loops round-robin across table count", () => {
    const rows = Array.from({ length: 68 }, (_, i) => ({
      tableNumber: i + 1,
      token: `token_${i + 1}`,
    }));
    const slots = buildA2QrSlots(rows);
    // slot 0 is table 1, slot 67 is table 68
    expect(slots[0].tableNumber).toBe(1);
    expect(slots[67].tableNumber).toBe(68);
    // slot 68 loops to table 1
    expect(slots[68].tableNumber).toBe(1);
    // slot 135 is table 68
    expect(slots[135].tableNumber).toBe(68);
    // slot 136 loops to table 1
    expect(slots[136].tableNumber).toBe(1);
    // slot 149 is table 14 (150th slot)
    expect(slots[149].tableNumber).toBe(14);
  });

  it("returns empty array for empty input", () => {
    expect(buildA2QrSlots([])).toEqual([]);
  });
});
