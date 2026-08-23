import { CREW_MESSAGE_MAX_LENGTH } from "./crew-message-domain";

export const ALL_CONFIRMATION = "BROADCAST SEMUA";

export type BroadcastRequest = {
  scope: "restaurant" | "all";
  restaurantId?: string;
  message: string;
  confirmation?: string;
};

export function validateBroadcastRequest(input: BroadcastRequest) {
  const message = input.message.trim();
  if (!message || message.length > CREW_MESSAGE_MAX_LENGTH)
    return { ok: false as const, code: "INVALID_MESSAGE" as const };
  if (input.scope === "restaurant" && !input.restaurantId)
    return { ok: false as const, code: "RESTAURANT_REQUIRED" as const };
  if (input.scope === "all" && input.confirmation !== ALL_CONFIRMATION)
    return { ok: false as const, code: "CONFIRMATION_REQUIRED" as const };
  return { ok: true as const, ...input, message };
}

export function groupBroadcastResults(
  results: ReadonlyArray<{ delivered: number; failed: number; rejected: number; expired: number }>,
) {
  const totals = results.reduce(
    (sum, result) => ({
      delivered: sum.delivered + result.delivered,
      failed: sum.failed + result.failed,
      rejected: sum.rejected + result.rejected,
      expired: sum.expired + result.expired,
    }),
    { delivered: 0, failed: 0, rejected: 0, expired: 0 },
  );
  return {
    ...totals,
    partial: totals.failed + totals.rejected + totals.expired > 0 && totals.delivered > 0,
  };
}
