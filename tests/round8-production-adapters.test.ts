import { describe, expect, it, vi } from "vitest";
import {
  cleanupManagerPendingSessionCore,
  confirmManagerHandoffCore,
  reconcileManagerHandoffCore,
} from "@/lib/staff-login.server";

const data = {
  managerToken: "a".repeat(64),
  rateLimitReservationId: "11111111-1111-4111-8111-111111111111",
};

describe("R8 production handoff adapters", () => {
  it("propagates confirm transport loss so the browser retries the same identity", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("response lost after commit"));
    await expect(confirmManagerHandoffCore({ rpc }, data)).rejects.toThrow("response lost");
  });

  it("does not retry a resolved authoritative confirm failure", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(confirmManagerHandoffCore({ rpc }, data)).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reads authoritative confirm state using the exact token and reservation pair", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "SUCCEEDED", error: null });
    await expect(reconcileManagerHandoffCore({ rpc }, data)).resolves.toBe("succeeded");
    expect(rpc).toHaveBeenCalledWith("reconcile_manager_session_handoff", {
      p_token: data.managerToken,
      p_reservation_id: data.rateLimitReservationId,
    });
  });

  it("treats malformed reconciliation responses as unknown", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(reconcileManagerHandoffCore({ rpc }, data)).resolves.toBe("unknown");
  });

  it("reports cleanup failure instead of hiding an RPC transport error", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("cleanup unavailable"));
    await expect(cleanupManagerPendingSessionCore({ rpc }, data, vi.fn())).rejects.toThrow(
      "cleanup unavailable",
    );
  });

  it("reports cleanup failure when durable failure accounting is unavailable", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const complete = vi.fn().mockRejectedValue(new Error("limiter unavailable"));
    await expect(cleanupManagerPendingSessionCore({ rpc }, data, complete)).rejects.toThrow(
      "limiter unavailable",
    );
  });
});
