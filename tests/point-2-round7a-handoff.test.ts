import { describe, expect, it, vi } from "vitest";
import { managerLoginHandoffCore, type ManagerHandoffDeps } from "../src/lib/manager-login-handoff";

const identity = {
  idManager: "m1",
  fullName: "Budi",
  restaurantId: "r1",
  restaurantDisplayName: "Resto",
  restaurantCode: "R1",
  managerToken: "token-a",
  rateLimitReservationId: "reservation-a",
};

function deps(overrides: Partial<ManagerHandoffDeps> = {}): ManagerHandoffDeps {
  return {
    ensureAccessToken: vi.fn(async () => "access"),
    getStorage: vi.fn(() => ({} as never)),
    writeIdentity: vi.fn((_storage, value) => value),
    setReminderFlag: vi.fn(),
    navigate: vi.fn(async () => undefined),
    confirmHandoff: vi.fn(async () => true),
    cleanupPending: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("R7-A manager handoff is exception-safe and authoritative", () => {
  it("cleans up when getStorage throws", async () => {
    const cleanupPending = vi.fn(async () => undefined);
    const d = deps({
      getStorage: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
      cleanupPending,
    });

    await expect(managerLoginHandoffCore(identity, d)).resolves.toEqual({
      ok: false,
      reason: "handoff_failed",
    });
    expect(cleanupPending).toHaveBeenCalledWith("token-a", "reservation-a");
  });

  it("cleans up when writeIdentity throws", async () => {
    const cleanupPending = vi.fn(async () => undefined);
    const d = deps({
      writeIdentity: vi.fn(() => {
        throw new Error("writer failed");
      }),
      cleanupPending,
    });

    await expect(managerLoginHandoffCore(identity, d)).resolves.toEqual({
      ok: false,
      reason: "handoff_failed",
    });
    expect(cleanupPending).toHaveBeenCalledTimes(1);
  });

  it("retries the same token and reservation after a lost confirm response", async () => {
    const cleanupPending = vi.fn(async () => undefined);
    const confirmHandoff = vi
      .fn<ManagerHandoffDeps["confirmHandoff"]>()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce(true);
    const d = deps({ confirmHandoff, cleanupPending });

    await expect(managerLoginHandoffCore(identity, d)).resolves.toEqual({ ok: true });
    expect(confirmHandoff).toHaveBeenCalledTimes(2);
    expect(confirmHandoff).toHaveBeenNthCalledWith(1, "token-a", "reservation-a");
    expect(confirmHandoff).toHaveBeenNthCalledWith(2, "token-a", "reservation-a");
    expect(cleanupPending).not.toHaveBeenCalled();
  });

  it("does not swallow cleanup failure after an authoritative failure", async () => {
    const cleanupPending = vi.fn(async () => {
      throw new Error("cleanup transport failed");
    });
    const d = deps({
      ensureAccessToken: vi.fn(async () => null),
      cleanupPending,
    });

    await expect(managerLoginHandoffCore(identity, d)).rejects.toThrow("cleanup transport failed");
    expect(cleanupPending).toHaveBeenCalledWith("token-a", "reservation-a");
  });
});
