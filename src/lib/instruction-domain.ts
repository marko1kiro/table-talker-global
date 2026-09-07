export const INSTRUCTION_MAX_LENGTH = 200;
export const REPLY_MAX_LENGTH = 100;

export type InstructionTargetType = "all" | "individual";

export type PendingInstruction = {
  instructionId: string;
  message: string;
  managerName: string;
  createdAt: string;
  expiresAt: string;
};

export type InstructionReceipt = {
  roleSessionId: string;
  displayName: string;
  role: string;
  ackAt: string | null;
  replyText: string | null;
  repliedAt: string | null;
};

export type InstructionThread = {
  instructionId: string;
  message: string;
  targetType: InstructionTargetType;
  targetDisplayName: string | null;
  createdAt: string;
  receipts: InstructionReceipt[];
};

export function computeWibMidnight(now: Date): string {
  const utcMs = now.getTime();
  const wibMs = utcMs + 7 * 60 * 60 * 1000;
  const wibDate = new Date(wibMs);
  const wibYear = wibDate.getUTCFullYear();
  const wibMonth = wibDate.getUTCMonth();
  const wibDay = wibDate.getUTCDate();
  const nextMidnightWib = Date.UTC(wibYear, wibMonth, wibDay + 1, 0, 0, 0);
  const nextMidnightUtc = nextMidnightWib - 7 * 60 * 60 * 1000;
  return new Date(nextMidnightUtc).toISOString();
}
