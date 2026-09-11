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
    persistPending: vi.fn(() => true),
    ensureAccessToken: vi.fn(async () => "anon-token"),
    getStorage: vi.fn(() => ({ setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() })),
    writeIdentity: vi.fn(() => storedIdentity),
    setReminderFlag: vi.fn(),
    navigate: vi.fn(async () => undefined),
    confirmHandoff: vi.fn(async () => true),
    reconcileHandoff: vi.fn(async () => "pending" as const),
    cleanupPending: vi.fn(async () => undefined),
    removeIdentity: vi.fn(),
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
    // P1-4: getStorage throws BEFORE any identity write succeeded, so there is
    // nothing written to remove — removeIdentity must never run here.
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        getStorage: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
        cleanupPending,
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "cleanup_failed" });
    expect(cleanupPending).toHaveBeenCalledWith("manager-token", "reservation-1");
    expect(removeIdentity).not.toHaveBeenCalled();
  });

  it("does not remove identity after storage-acquisition throw even when cleanup succeeds", async () => {
    // P1-4 gate proof: cleanup succeeds here, which normally triggers removal,
    // but nothing was ever written, so the identityWritten flag must block it.
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        getStorage: vi.fn(() => {
          throw new Error("storage unavailable");
        }),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(removeIdentity).not.toHaveBeenCalled();
  });
});

describe("P1-4 stale identity cleanup on definitive post-write failure", () => {
  it("removes identity once after navigation rejection with successful cleanup", async () => {
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        navigate: vi.fn(async () => {
          throw new Error("navigation failed");
        }),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(removeIdentity).toHaveBeenCalledTimes(1);
  });

  it("keeps handoff_failed when removeIdentity throws after navigation failure and successful cleanup", async () => {
    // Reviewer finding: removal is best-effort. A storage throw after the
    // server already cleaned up must not escape a rejection nor downgrade the
    // result to cleanup_failed — cleanup genuinely succeeded.
    const removeIdentity = vi.fn(() => {
      throw new Error("identity removal failed");
    });
    const cleanupPending = vi.fn(async () => undefined);
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        navigate: vi.fn(async () => {
          throw new Error("navigation failed");
        }),
        cleanupPending,
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(cleanupPending).toHaveBeenCalledWith("manager-token", "reservation-1");
    expect(removeIdentity).toHaveBeenCalledTimes(1);
  });

  it("keeps handoff_failed when removeIdentity throws on authoritative reconciliation failed", async () => {
    const removeIdentity = vi.fn(() => {
      throw new Error("identity removal failed");
    });
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        confirmHandoff: vi.fn(async () => false),
        reconcileHandoff: vi.fn(async () => "failed" as const),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(removeIdentity).toHaveBeenCalledTimes(1);
  });

  it("removes identity once on authoritative reconciliation failed", async () => {
    const removeIdentity = vi.fn();
    const cleanupPending = vi.fn(async () => undefined);
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        confirmHandoff: vi.fn(async () => false),
        reconcileHandoff: vi.fn(async () => "failed" as const),
        cleanupPending,
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(cleanupPending).not.toHaveBeenCalled();
    expect(removeIdentity).toHaveBeenCalledTimes(1);
  });

  it("removes identity once after successful cleanup on pending reconciliation", async () => {
    const removeIdentity = vi.fn();
    const cleanupPending = vi.fn(async () => undefined);
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        confirmHandoff: vi.fn(async () => false),
        reconcileHandoff: vi.fn(async () => "pending" as const),
        cleanupPending,
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(cleanupPending).toHaveBeenCalledWith("manager-token", "reservation-1");
    expect(removeIdentity).toHaveBeenCalledTimes(1);
  });

  it("preserves identity when reconciliation is unknown", async () => {
    const removeIdentity = vi.fn();
    const cleanupPending = vi.fn(async () => undefined);
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        confirmHandoff: vi.fn(async () => false),
        reconcileHandoff: vi.fn(async () => "unknown" as const),
        cleanupPending,
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "reconciliation_unknown" });
    expect(cleanupPending).not.toHaveBeenCalled();
    expect(removeIdentity).not.toHaveBeenCalled();
  });

  it("preserves identity when cleanup throws", async () => {
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        navigate: vi.fn(async () => {
          throw new Error("navigation failed");
        }),
        cleanupPending: vi.fn(async () => {
          throw new Error("cleanup unavailable");
        }),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "cleanup_failed" });
    expect(removeIdentity).not.toHaveBeenCalled();
  });

  it("does not remove identity on pre-write persistence failure", async () => {
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        persistPending: vi.fn(() => false),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(removeIdentity).not.toHaveBeenCalled();
  });

  it("does not remove identity on pre-write token failure", async () => {
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        ensureAccessToken: vi.fn(async () => null),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(removeIdentity).not.toHaveBeenCalled();
  });

  it("does not remove identity when write returns null", async () => {
    const removeIdentity = vi.fn();
    const result = await managerLoginHandoffCore(
      identity,
      deps({
        writeIdentity: vi.fn(() => null),
        removeIdentity,
      }),
    );
    expect(result).toEqual({ ok: false, reason: "handoff_failed" });
    expect(removeIdentity).not.toHaveBeenCalled();
  });
});
