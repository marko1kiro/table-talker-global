import { describe, expect, it } from "vitest";
import { loginInputSchema } from "@/lib/auth";
import {
  acceptInviteInputSchema,
  recoveryConsumeInputSchema,
  recoveryRequestInputSchema,
} from "@/lib/super-admin-auth.server";
import { submitResetRequestInputSchema } from "@/lib/staff-password-reset.server";

const key = "logical-attempt-key-123456";

describe("R8 stable logical attempt identity contracts", () => {
  it("requires an attempt key for Super Admin and legacy login", () => {
    const base = { mode: "individual", staffId: "admin", password: "password", clientKey: key };
    expect(loginInputSchema.safeParse(base).success).toBe(false);
    expect(loginInputSchema.safeParse({ ...base, attemptKey: key }).success).toBe(true);
  });

  it("requires an attempt key for invite accept and recovery", () => {
    const accept = { staffId: "admin", token: "t".repeat(16), password: "password", clientKey: key };
    expect(acceptInviteInputSchema.safeParse(accept).success).toBe(false);
    expect(acceptInviteInputSchema.safeParse({ ...accept, attemptKey: key }).success).toBe(true);

    expect(recoveryRequestInputSchema.safeParse({ email: "a@example.com" }).success).toBe(false);
    expect(
      recoveryRequestInputSchema.safeParse({ email: "a@example.com", attemptKey: key }).success,
    ).toBe(true);

    expect(recoveryConsumeInputSchema.safeParse(accept).success).toBe(false);
    expect(recoveryConsumeInputSchema.safeParse({ ...accept, attemptKey: key }).success).toBe(true);
  });

  it("requires an attempt key for Manager and AM reset requests", () => {
    const reset = { staffId: "manager", newPassword: "password", clientKey: key };
    expect(submitResetRequestInputSchema.safeParse(reset).success).toBe(false);
    expect(submitResetRequestInputSchema.safeParse({ ...reset, attemptKey: key }).success).toBe(true);
  });
});
