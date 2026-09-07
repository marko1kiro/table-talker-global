import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAnonAuthedSupabaseClient, type RpcCaller } from "./role-session.server";
import type {
  InstructionThread,
  InstructionReceipt,
  InstructionTargetType,
} from "./instruction-domain";

const GENERIC = "Gagal mengirim instruksi.";

const KNOWN_ERRORS = new Set([
  "INVALID_SESSION",
  "INVALID_TARGET_TYPE",
  "INVALID_MESSAGE",
  "INVALID_TARGET",
  "NO_ACTIVE_CREW",
]);

export type SendInstructionResult =
  | { ok: true; instructionId: string }
  | { ok: false; code: string; message: string };

export async function sendManagerInstructionCore(
  data: {
    managerToken: string;
    targetType: InstructionTargetType;
    targetRoleSessionId: string | null;
    message: string;
  },
  rpc: RpcCaller,
): Promise<SendInstructionResult> {
  try {
    const { data: result, error } = await rpc("send_manager_instruction", {
      p_manager_token: data.managerToken,
      p_target_type: data.targetType,
      p_target_role_session_id: data.targetRoleSessionId,
      p_message: data.message,
    });
    if (error) {
      const code = KNOWN_ERRORS.has(error.message) ? error.message : "UNAVAILABLE";
      return { ok: false, code, message: GENERIC };
    }
    return { ok: true, instructionId: String(result) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: GENERIC };
  }
}

export type InstructionThreadResult =
  | { ok: true; threads: InstructionThread[] }
  | { ok: false; code: string; message: string };

function normalizeThread(raw: unknown): InstructionThread {
  const r = raw as Record<string, unknown>;
  const receipts = (Array.isArray(r.receipts) ? r.receipts : []).map((rc: unknown) => {
    const c = rc as Record<string, unknown>;
    return {
      roleSessionId: String(c.role_session_id),
      displayName: String(c.display_name),
      role: String(c.role),
      ackAt: typeof c.ack_at === "string" ? c.ack_at : null,
      replyText: typeof c.reply_text === "string" ? c.reply_text : null,
      repliedAt: typeof c.replied_at === "string" ? c.replied_at : null,
    } satisfies InstructionReceipt;
  });
  return {
    instructionId: String(r.instruction_id),
    message: String(r.message),
    targetType: r.target_type === "individual" ? "individual" : "all",
    targetDisplayName: typeof r.target_display_name === "string" ? r.target_display_name : null,
    createdAt: String(r.created_at),
    receipts,
  };
}

export async function getInstructionThreadCore(
  data: { managerToken: string; date?: string },
  rpc: RpcCaller,
): Promise<InstructionThreadResult> {
  try {
    const { data: raw, error } = await rpc("get_instruction_thread", {
      p_manager_token: data.managerToken,
      p_date: data.date ?? null,
    });
    if (error) {
      const code = error.message === "INVALID_SESSION" ? "INVALID_SESSION" : "UNAVAILABLE";
      return { ok: false, code, message: "Gagal memuat pesan." };
    }
    const rows = Array.isArray(raw) ? raw : [];
    return { ok: true, threads: rows.map(normalizeThread) };
  } catch {
    return { ok: false, code: "UNAVAILABLE", message: "Gagal memuat pesan." };
  }
}

export const sendManagerInstructionInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  targetType: z.enum(["all", "individual"]),
  targetRoleSessionId: z.string().uuid().nullable(),
  message: z.string().min(1).max(200),
});

export const sendManagerInstruction = createServerFn({ method: "POST" })
  .validator(sendManagerInstructionInputSchema)
  .handler(async ({ data }): Promise<SendInstructionResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: GENERIC };
    return sendManagerInstructionCore(
      {
        managerToken: data.managerToken,
        targetType: data.targetType,
        targetRoleSessionId: data.targetRoleSessionId,
        message: data.message,
      },
      async (fn, params) => client.rpc(fn, params),
    );
  });

export const getInstructionThreadInputSchema = z.object({
  managerToken: z.string().min(1),
  accessToken: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const getInstructionThread = createServerFn({ method: "GET" })
  .validator(getInstructionThreadInputSchema)
  .handler(async ({ data }): Promise<InstructionThreadResult> => {
    const client = getAnonAuthedSupabaseClient(data.accessToken);
    if (!client) return { ok: false, code: "UNAVAILABLE", message: "Gagal memuat pesan." };
    return getInstructionThreadCore(
      { managerToken: data.managerToken, date: data.date },
      async (fn, params) => client.rpc(fn, params),
    );
  });
