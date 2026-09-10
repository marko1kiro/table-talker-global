import { describe, expect, it, vi } from "vitest";
import { managerLoginHandoffCore } from "@/lib/manager-login-handoff";
import type { ManagerIdentity } from "@/lib/manager-session-identity";

const identity = {
  idManager: "m-1",
  fullName: "Manager",
  restaurantId: "r-1",
  restaurantDisplayName: "Restaurant",
  restaurantCode: "rest",
  managerToken: "manager-token",
  rateLimitReservationId: "reservation-1",
} satisfies Parameters<typeof managerLoginHandoffCore>[0];

const storedIdentity = { ...identity, accessToken: "anon-token" } as ManagerIdentity;

function deps(overrides: Partial<Parameters<typeof managerLoginHandoffCore>[1]> = {}) {
  return {
    ensureAccessToken: vi.fn(async () => "anon-token"),
    getStorage: vi.fn(() => ({ setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() })),
    writeIdentity: vi.fn(() => storedIdentity),
    setReminderFlag: vi.fn(),
    navigate: vi.fn(async () => undefined),
    confirmHandoff: vi.fn(async () => true),
    cleanupPending: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("R7-A manager handoff", () => {
  it("retries same token and reservation after lost confirm response", async () => {
    const confirmHandoff = vi
      .fn(async (_managerToken: string, _reservationId: string) => true)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(true);
    const result = await managerLoginHandoffCore(identity, deps({ confirmHandoff }));
    expect(result).toEqual({ ok: true });
    expect(confirmHandoff).toHaveBeenCalledTimes(2);
    expect(confirmHandoff).toHaveBeenNthCalledWith(1, "manager-token", "reservation-1");
    expect(confirmHandoff).toHaveBeenNthCalledWith(2, "manager-token", "reservation-1");
  });

  it("does not hide cleanup failure after storage acquisition throws", async () => {
    const cleanupPending = vi.fn(async () => {
      throw new Error("cleanup unavailable");
    });
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        getStorage: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
        cleanupPending,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "cleanup_failed" });
    expect(cleanupPending).toHaveBeenCalledWith("manager-token", "reservation-1");
  });
});
