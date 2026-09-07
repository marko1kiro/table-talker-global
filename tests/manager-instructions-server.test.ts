import { describe, expect, it } from "vitest";
import {
  sendManagerInstructionCore,
  getInstructionThreadCore,
} from "../src/lib/manager-instructions.server";

describe("sendManagerInstructionCore", () => {
  it("calls send_manager_instruction RPC with correct params", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      calls.push([fn, params]);
      return { data: "fake-uuid", error: null };
    };
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "Test",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: true, instructionId: "fake-uuid" });
    expect(calls[0][0]).toBe("send_manager_instruction");
    expect(calls[0][1]).toMatchObject({
      p_manager_token: "tok",
      p_target_type: "all",
      p_message: "Test",
    });
  });

  it("maps INVALID_SESSION error", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "INVALID_SESSION" },
    });
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "X",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("maps NO_ACTIVE_CREW error", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "NO_ACTIVE_CREW" },
    });
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "X",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "NO_ACTIVE_CREW" });
  });

  it("maps unknown error to UNAVAILABLE", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "something_else" },
    });
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "X",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });

  it("handles thrown exception as UNAVAILABLE", async () => {
    const rpc = async () => {
      throw new Error("network");
    };
    const r = await sendManagerInstructionCore(
      {
        managerToken: "tok",
        targetType: "all",
        targetRoleSessionId: null,
        message: "X",
      },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("getInstructionThreadCore", () => {
  it("normalizes thread response", async () => {
    const rpc = async () => ({
      data: [
        {
          instruction_id: "i1",
          message: "Hello",
          target_type: "all",
          target_display_name: null,
          created_at: "2026-09-07T07:00:00Z",
          receipts: [
            {
              role_session_id: "rs1",
              display_name: "Budi",
              role: "kasir",
              ack_at: "2026-09-07T07:01:00Z",
              reply_text: "Siap",
              replied_at: "2026-09-07T07:01:00Z",
            },
          ],
        },
      ],
      error: null,
    });
    const r = await getInstructionThreadCore({ managerToken: "tok" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.threads).toHaveLength(1);
      expect(r.threads[0].message).toBe("Hello");
      expect(r.threads[0].receipts[0].displayName).toBe("Budi");
      expect(r.threads[0].receipts[0].replyText).toBe("Siap");
    }
  });

  it("maps INVALID_SESSION error", async () => {
    const rpc = async () => ({
      data: null,
      error: { message: "INVALID_SESSION" },
    });
    const r = await getInstructionThreadCore({ managerToken: "tok" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("returns empty threads for empty array", async () => {
    const rpc = async () => ({ data: [], error: null });
    const r = await getInstructionThreadCore({ managerToken: "tok" }, rpc);
    expect(r).toMatchObject({ ok: true, threads: [] });
  });
});
