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

// R8 contract: a stable logical attemptKey is MANDATORY on every login payload
// so a retry re-reserves the same rate-limit attempt instead of double-counting
// it (see tests/round8-attempt-identity-contract.test.ts and
// src/lib/auth.ts loginInputSchema). The positive cases below therefore carry
// attemptKey; a payload without one must be rejected before authentication.
it("rejects malformed login payloads before authentication", () => {
  const attemptKey = "attempt-key-123456";
  expect(loginInputSchema.safeParse({}).success).toBe(false);
  expect(loginInputSchema.safeParse({ password: 1 }).success).toBe(false);
  expect(
    loginInputSchema.safeParse({
      mode: "individual",
      password: "secret",
      clientKey: "short",
      attemptKey,
    }).success,
  ).toBe(false);
  expect(
    loginInputSchema.safeParse({
      mode: "individual",
      staffId: "sadmin1",
      password: "secret",
      clientKey: "client-key-123456",
      attemptKey,
    }).success,
  ).toBe(true);
  expect(
    loginInputSchema.safeParse({
      mode: "legacy",
      password: "secret",
      clientKey: "client-key-123456",
      attemptKey,
    }).success,
  ).toBe(true);
  // attemptKey is mandatory and length-bounded like clientKey.
  expect(
    loginInputSchema.safeParse({
      mode: "legacy",
      password: "secret",
      clientKey: "client-key-123456",
    }).success,
  ).toBe(false);
  expect(
    loginInputSchema.safeParse({
      mode: "legacy",
      password: "secret",
      clientKey: "client-key-123456",
      attemptKey: "short",
    }).success,
  ).toBe(false);
  // mode is mandatory: there is no implicit legacy fallback.
  expect(
    loginInputSchema.safeParse({ password: "secret", clientKey: "client-key-123456", attemptKey })
      .success,
  ).toBe(false);
});
