import { expect, it } from "vitest";
import { validateRestaurantCode } from "../src/lib/restaurant-domain";

const code = (suffix = "") => `${"A".repeat(6 - suffix.length)}${suffix}`;

it("accepts exact uppercase ASCII codes from six through thirty-two characters", () => {
  expect(validateRestaurantCode(code())).toEqual({ code: code() });
  expect(validateRestaurantCode("A".repeat(32))).toEqual({ code: "A".repeat(32) });
});

it("rejects transformed and malformed values without returning input", () => {
  for (const value of [
    "a".repeat(6),
    ` ${code()}`,
    `${code()} `,
    "A".repeat(5),
    "A".repeat(33),
    "A-BBBB",
    "A_BBBB",
    "AＡBBBB",
    "",
  ]) {
    expect(validateRestaurantCode(value)).toEqual({ error: "Kode Resto salah." });
  }
});
