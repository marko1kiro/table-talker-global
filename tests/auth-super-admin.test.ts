import { expect, it } from "vitest";
import { isSuperAdminPasswordValid } from "../src/lib/auth";

it("uses absent environment as fail-closed and compares valid passwords", () => {
  expect(isSuperAdminPasswordValid("secret", null)).toBe(false);
  expect(isSuperAdminPasswordValid("secret", "other")).toBe(false);
  expect(isSuperAdminPasswordValid("secret", "secret")).toBe(true);
});
