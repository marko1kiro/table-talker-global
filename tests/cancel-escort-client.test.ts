import { describe, expect, it, vi } from "vitest";
import { cancelEscortIntentCore } from "../src/lib/table-occupancy.server";

const INPUT = {
  intentId: "7359da62-dc98-4a81-9a0f-56da46f32f70",
  sessionToken: "tok",
};

describe("cancelEscortIntentCore", () => {
  it("returns ok with the RPC's boolean", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    expect(await cancelEscortIntentCore(INPUT, rpc)).toEqual({ ok: true, cancelled: true });
    expect(rpc).toHaveBeenCalledWith("cancel_escort_intent", {
      p_intent_id: INPUT.intentId,
      p_session_token: INPUT.sessionToken,
    });
  });

  it("treats an already-resolved intent as ok (idempotent)", async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    expect(await cancelEscortIntentCore(INPUT, rpc)).toEqual({ ok: true, cancelled: false });
  });

  it("maps INVALID_SESSION and never leaks the raw error", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "INVALID_SESSION detail" } }));
    const result = await cancelEscortIntentCore(INPUT, rpc);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("detail");
  });
});
