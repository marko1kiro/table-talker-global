import { afterEach, describe, expect, it } from "vitest";
import { LoginMaintenanceError, requireLoginAvailable } from "@/lib/login-maintenance.server";

const original = process.env.MAINTENANCE_MODE;

afterEach(() => {
  if (original === undefined) delete process.env.MAINTENANCE_MODE;
  else process.env.MAINTENANCE_MODE = original;
});

describe("login maintenance", () => {
  it("allows login when login_lock is absent", () => {
    delete process.env.MAINTENANCE_MODE;

    expect(() => requireLoginAvailable()).not.toThrow();
  });

  it("rejects login_lock with a 503 maintenance error", () => {
    process.env.MAINTENANCE_MODE = "login_lock";

    expect(() => requireLoginAvailable()).toThrow(LoginMaintenanceError);
    expect(() => requireLoginAvailable()).toThrow("LOGIN_MAINTENANCE");

    try {
      requireLoginAvailable();
    } catch (error) {
      expect(error).toMatchObject({ status: 503, code: "LOGIN_MAINTENANCE" });
    }
  });
});
