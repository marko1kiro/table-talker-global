import { z } from "zod";

export const CREW_MESSAGE_MAX_LENGTH = 200;
export const CREW_MESSAGE_AUTO_CLOSE_MS = 5_000;
export const CREW_MESSAGE_TTL_MS = 6_000;

const targetSessionId = z.string().uuid();

export type CrewMessage = {
  id: string;
  target_session_id: string;
  message: string;
  created_at: string;
  expires_at: string;
};

export type ValidateCrewMessageResult =
  | { targetSessionId: string; message: string }
  | { error: string };

export function validateCrewMessageRequest(input: {
  targetSessionId: string;
  message: string;
}): ValidateCrewMessageResult {
  if (!targetSessionId.safeParse(input.targetSessionId).success) {
    return { error: "Crew target tidak valid." };
  }
  if (input.message.trim() === "") {
    return { error: "Nama wajib diisi." };
  }
  if (input.message.length > CREW_MESSAGE_MAX_LENGTH) {
    return { error: "Pesan maksimal 200 karakter." };
  }
  return { targetSessionId: input.targetSessionId, message: input.message };
}

export function isDuplicateCrewMessage(
  id: string,
  delivered: Map<string, number>,
  now: number,
): boolean {
  pruneDeliveredCrewMessages(delivered, now);
  return delivered.has(id);
}

export function markDeliveredCrewMessage(
  id: string,
  delivered: Map<string, number>,
  now: number,
) {
  delivered.set(id, now);
}

export function pruneDeliveredCrewMessages(
  delivered: Map<string, number>,
  now: number,
  maxAgeMs = CREW_MESSAGE_TTL_MS,
  maxCount = 128,
) {
  for (const [id, deliveredAt] of delivered) {
    if (deliveredAt <= now - maxAgeMs) delivered.delete(id);
  }
  if (delivered.size <= maxCount) return;
  for (const [id] of [...delivered].sort(([, a], [, b]) => a - b)) {
    delivered.delete(id);
    if (delivered.size <= maxCount) return;
  }
}
