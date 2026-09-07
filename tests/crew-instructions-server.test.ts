import { describe, expect, it } from "vitest";
import {
  getPendingInstructionsCore,
  ackInstructionCore,
} from "../src/lib/crew-instructions.server";

describe("getPendingInstructionsCore", () => {
  it("normalizes pending instructions from RPC", async () => {
    const rpc = async () => ({
      data: [
        {
          instruction_id: "i1",
          message: "Meja 7 prioritas",
          manager_name: "Pak Dirga",
          created_at: "2026-09-07T07:00:00Z",
          expires_at: "2026-09-07T17:00:00Z",
        },
      ],
      error: null,
    });
    const r = await getPendingInstructionsCore({ roleSessionToken: "tok" }, rpc);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.instructions).toHaveLength(1);
      expect(r.instructions[0]).toMatchObject({
        instructionId: "i1",
        message: "Meja 7 prioritas",
        managerName: "Pak Dirga",
      });
    }
  });

  it("maps INVALID_SESSION error", async () => {
    const rpc = async () => ({ data: null, error: { message: "INVALID_SESSION" } });
    const r = await getPendingInstructionsCore({ roleSessionToken: "tok" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "INVALID_SESSION" });
  });

  it("returns empty for empty array", async () => {
    const rpc = async () => ({ data: [], error: null });
    const r = await getPendingInstructionsCore({ roleSessionToken: "tok" }, rpc);
    expect(r).toMatchObject({ ok: true, instructions: [] });
  });

  it("handles thrown exception", async () => {
    const rpc = async () => {
      throw new Error("network");
    };
    const r = await getPendingInstructionsCore({ roleSessionToken: "tok" }, rpc);
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});

describe("ackInstructionCore", () => {
  it("calls ack_instruction RPC and returns ok", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      calls.push([fn, params]);
      return { data: true, error: null };
    };
    const r = await ackInstructionCore(
      { roleSessionToken: "tok", instructionId: "i1", replyText: "Siap" },
      rpc,
    );
    expect(r).toMatchObject({ ok: true });
    expect(calls[0][0]).toBe("ack_instruction");
    expect(calls[0][1]).toMatchObject({
      p_role_session_token: "tok",
      p_instruction_id: "i1",
      p_reply_text: "Siap",
    });
  });

  it("calls with null reply when no reply given", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const rpc = async (fn: string, params: Record<string, unknown>) => {
      calls.push([fn, params]);
      return { data: true, error: null };
    };
    await ackInstructionCore(
      { roleSessionToken: "tok", instructionId: "i1", replyText: null },
      rpc,
    );
    expect(calls[0][1].p_reply_text).toBeNull();
  });

  it("maps error to UNAVAILABLE", async () => {
    const rpc = async () => ({ data: null, error: { message: "something" } });
    const r = await ackInstructionCore(
      { roleSessionToken: "tok", instructionId: "i1", replyText: null },
      rpc,
    );
    expect(r).toMatchObject({ ok: false, code: "UNAVAILABLE" });
  });
});
