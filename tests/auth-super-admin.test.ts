import { expect, it } from "vitest";
import { isPasswordValid } from "../src/lib/auth.server";

it("fails closed and compares fixed-length password digests", () => {
  expect(isPasswordValid("secret", null)).toBe(false);
  expect(isPasswordValid("secret", "other")).toBe(false);
  expect(isPasswordValid("secret", "secret")).toBe(true);
  expect(isPasswordValid("s", "a much longer password")).toBe(false);
});
