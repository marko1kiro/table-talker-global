import { describe, expect, it } from "vitest";
import {
  computeWibMidnight,
  type InstructionTargetType,
  INSTRUCTION_MAX_LENGTH,
  REPLY_MAX_LENGTH,
} from "../src/lib/instruction-domain";

describe("computeWibMidnight", () => {
  it("returns next WIB midnight as ISO string for a daytime WIB instant", () => {
    const result = computeWibMidnight(new Date("2026-09-07T07:00:00Z"));
    expect(result).toBe("2026-09-07T17:00:00.000Z");
  });
  it("returns same-day 17:00 UTC for an early-UTC instant (still previous WIB day)", () => {
    const result = computeWibMidnight(new Date("2026-09-07T01:00:00Z"));
    expect(result).toBe("2026-09-07T17:00:00.000Z");
  });
  it("handles late WIB night (23:59 WIB = 16:59 UTC)", () => {
    const result = computeWibMidnight(new Date("2026-09-07T16:59:00Z"));
    expect(result).toBe("2026-09-07T17:00:00.000Z");
  });
  it("handles exactly WIB midnight (00:00 WIB = 17:00 UTC prev day)", () => {
    const result = computeWibMidnight(new Date("2026-09-07T17:00:00Z"));
    expect(result).toBe("2026-09-08T17:00:00.000Z");
  });
});

describe("constants", () => {
  it("exports correct limits", () => {
    expect(INSTRUCTION_MAX_LENGTH).toBe(200);
    expect(REPLY_MAX_LENGTH).toBe(100);
  });
  it("InstructionTargetType includes expected values", () => {
    const valid: InstructionTargetType[] = ["all", "individual"];
    expect(valid).toHaveLength(2);
  });
});
