import { expect, it } from "vitest";
import { loginInputSchema, ownerLoginFailure } from "../src/lib/auth";
import { isPasswordValid } from "../src/lib/auth.server";

it("fails closed and compares fixed-length password digests", () => {
  expect(isPasswordValid("secret", null)).toBe(false);
  expect(isPasswordValid("secret", "other")).toBe(false);
  expect(isPasswordValid("secret", "secret")).toBe(true);
  expect(isPasswordValid("s", "a much longer password")).toBe(false);
});

it("uses one public login failure message", () => {
  expect(ownerLoginFailure()).toEqual({
    ok: false,
    message: "Login gagal. Periksa kembali ID dan password.",
  });
});

it("rejects malformed login payloads before authentication", () => {
  expect(loginInputSchema.safeParse({}).success).toBe(false);
  expect(loginInputSchema.safeParse({ password: 1 }).success).toBe(false);
  expect(
    loginInputSchema.safeParse({ mode: "individual", password: "secret", clientKey: "short" })
      .success,
  ).toBe(false);
  expect(
    loginInputSchema.safeParse({
      mode: "individual",
      staffId: "sadmin1",
      password: "secret",
      clientKey: "client-key-123456",
    }).success,
  ).toBe(true);
  expect(
    loginInputSchema.safeParse({
      mode: "legacy",
      password: "secret",
      clientKey: "client-key-123456",
    }).success,
  ).toBe(true);
  // mode is mandatory: there is no implicit legacy fallback.
  expect(
    loginInputSchema.safeParse({ password: "secret", clientKey: "client-key-123456" }).success,
  ).toBe(false);
});
