type BroadcastResponse = { ok: boolean; code?: string };

const TERMINAL_CODES = new Set([
  "INVALID_MESSAGE",
  "RESTAURANT_REQUIRED",
  "CONFIRMATION_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "RATE_LIMITED",
  "RESTAURANT_NOT_FOUND",
  "BATCH_TOO_LARGE",
]);

export function shouldResetBroadcastIdempotencyKey(response: BroadcastResponse) {
  return response.ok || (response.code !== undefined && TERMINAL_CODES.has(response.code));
}
