import { expect, it } from "vitest";
import { validateRestaurantCode } from "../src/lib/restaurant-domain";
import { redactCredentialAudit } from "../src/lib/restaurant-code.server";

const code = (suffix = "") => `${"A".repeat(6 - suffix.length)}${suffix}`;

it("accepts exact uppercase ASCII codes from six through thirty-two characters", () => {
  expect(validateRestaurantCode(code())).toEqual({ code: code() });
  expect(validateRestaurantCode("A".repeat(32))).toEqual({ code: "A".repeat(32) });
  expect(validateRestaurantCode("KAMPUNG-BULU")).toEqual({ code: "KAMPUNG-BULU" });
});

it("rejects transformed and malformed values without returning input", () => {
  for (const value of [
    "a".repeat(6),
    ` ${code()}`,
    `${code()} `,
    "A".repeat(5),
    "A".repeat(33),
    "A_BBBB",
    "AＡBBBB",
    "",
  ]) {
    expect(validateRestaurantCode(value)).toEqual({ error: "Kode Resto salah." });
  }
});

it("redacts plain code and other credential fields from audit payloads", () => {
  expect(
    JSON.stringify(
      redactCredentialAudit({
        code: code(),
        credential: "value",
        token: "value",
        reason: "failed",
      }),
    ),
  ).toBe('{"reason":"failed"}');
});

it("recursively redacts credential fields inside nested objects and arrays", () => {
  expect(
    redactCredentialAudit([{ code: "SECRET", operation: "viewed" }, { authorization: "bearer x" }]),
  ).toEqual([{ operation: "viewed" }, {}]);
});
