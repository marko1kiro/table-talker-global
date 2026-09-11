import { describe, expect, it, vi } from "vitest";
import {
  managerLoginHandoffCore,
  type ManagerHandoffDeps,
  type ManagerHandoffIdentity,
} from "@/lib/manager-login-handoff";

const identity: ManagerHandoffIdentity = {
  idManager: "manager-1",
  fullName: "Manager One",
  restaurantId: "restaurant-1",
  restaurantDisplayName: "Restaurant One",
  restaurantCode: "REST-1",
  managerToken: "a".repeat(64),
  rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
};

type ReconciliationVerdict = "succeeded" | "pending" | "failed" | "unknown";

type ReconciliationDeps = ManagerHandoffDeps & {
  reconcileHandoff: (
    managerToken: string,
    rateLimitReservationId: string,
  ) => Promise<ReconciliationVerdict>;
};

function deps(overrides: Partial<ReconciliationDeps> = {}): ReconciliationDeps {
  return {
    persistPending: vi.fn(() => true),
    ensureAccessToken: vi.fn().mockResolvedValue("anon-access-token"),
    getStorage: vi.fn().mockReturnValue({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }),
    writeIdentity: vi.fn().mockImplementation((_storage, value) => value),
    setReminderFlag: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    confirmHandoff: vi.fn().mockResolvedValue(true),
    reconcileHandoff: vi.fn().mockResolvedValue("unknown"),
    cleanupPending: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("R8 authoritative manager confirm reconciliation", () => {
  it("retries the same token and reservation after a resolved false confirm response", async () => {
    const confirmHandoff = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const cleanupPending = vi.fn().mockResolvedValue(undefined);

    const result = await managerLoginHandoffCore(
      identity,
      deps({ confirmHandoff, cleanupPending }),
    );

    expect(result).toEqual({ ok: true });
    expect(confirmHandoff).toHaveBeenCalledTimes(2);
    expect(confirmHandoff).toHaveBeenNthCalledWith(
      2,
      identity.managerToken,
      identity.rateLimitReservationId,
    );
    expect(cleanupPending).not.toHaveBeenCalled();
  });

  it("accepts authoritative succeeded state after both confirm responses are lost", async () => {
    const confirmHandoff = vi.fn().mockRejectedValue(new Error("response lost"));
    const reconcileHandoff = vi.fn().mockResolvedValue("succeeded");
    const cleanupPending = vi.fn().mockResolvedValue(undefined);

    const result = await managerLoginHandoffCore(
      identity,
      deps({ confirmHandoff, reconcileHandoff, cleanupPending }),
    );

    expect(result).toEqual({ ok: true });
    expect(confirmHandoff).toHaveBeenCalledTimes(2);
    expect(reconcileHandoff).toHaveBeenCalledWith(
      identity.managerToken,
      identity.rateLimitReservationId,
    );
    expect(cleanupPending).not.toHaveBeenCalled();
  });

  it("does not compensate an active session when reconciliation is uncertain", async () => {
    const confirmHandoff = vi.fn().mockResolvedValue(false);
    const reconcileHandoff = vi.fn().mockResolvedValue("unknown");
    const cleanupPending = vi.fn().mockResolvedValue(undefined);

    const result = await managerLoginHandoffCore(
      identity,
      deps({ confirmHandoff, reconcileHandoff, cleanupPending }),
    );

    expect(result).toEqual({ ok: false, reason: "reconciliation_unknown" });
    expect(cleanupPending).not.toHaveBeenCalled();
  });
});
