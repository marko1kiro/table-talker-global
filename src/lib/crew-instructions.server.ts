import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";
import type { PendingInstruction } from "./instruction-domain";

const GENERIC = "Gagal memuat instruksi.";

export type PendingInstructionsResult =
  | { ok: true; instructions: PendingInstruction[] }
  | { ok: false; code: string; message: string };

export async function getPendingInstructionsCore(
  data: { roleSessionToken: string },
  rpc: RpcCaller,
): Promise<PendingInstructionsResult> {
  try {
    const { data: rows, error } = await rpc("get_pending_instructions", {
      p_role_session_token: data.roleSessionToken,
    });
    if (error) {
      const code = error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE";
      return { ok: false, code, message: GENERIC };
    }
    if (!Array.isArray(rows)) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    const instructions = rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        instructionId: String(r.instruction_id),
        message: String(r.message),
        managerName: String(r.manager_name),
        createdAt: String(r.created_at),
        expiresAt: String(r.expires_at),
      } satisfies PendingInstruction;
    });
    return { ok: true, instructions };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export type AckInstructionResult = { ok: true } | { ok: false; code: string; message: string };

export async function ackInstructionCore(
  data: {
    roleSessionToken: string;
    instructionId: string;
    replyText: string | null;
  },
  rpc: RpcCaller,
): Promise<AckInstructionResult> {
  try {
    const { error } = await rpc("ack_instruction", {
      p_role_session_token: data.roleSessionToken,
      p_instruction_id: data.instructionId,
      p_reply_text: data.replyText,
    });
    if (error) {
      const code = error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE";
      return { ok: false, code, message: "Gagal mengirim konfirmasi." };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "Gagal mengirim konfirmasi." };
  }
}

export const getPendingInstructions = createServerFn({ method: "GET" })
  .validator(
    z.object({
      roleSessionToken: z.string().min(1),
      accessToken: z.string().min(1),
    }),
  )
  .handler(async ({ data }): Promise<PendingInstructionsResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return getPendingInstructionsCore(
      { roleSessionToken: data.roleSessionToken },
      async (fn, params) => client.rpc(fn, params),
    );
  });

export const ackInstruction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      roleSessionToken: z.string().min(1),
      accessToken: z.string().min(1),
      instructionId: z.string().uuid(),
      replyText: z.string().max(100).nullable(),
    }),
  )
  .handler(async ({ data }): Promise<AckInstructionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client)
      return {
        ok: false,
        code: "UNAVAILABLE",
        message: "Gagal mengirim konfirmasi.",
      };
    return ackInstructionCore(
      {
        roleSessionToken: data.roleSessionToken,
        instructionId: data.instructionId,
        replyText: data.replyText,
      },
      async (fn, params) => client.rpc(fn, params),
    );
  });
