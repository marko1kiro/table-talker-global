const DAY_MS = 86_400_000;
const MAX_HISTORY_DAYS = 30;
const MAX_SEARCH_LENGTH = 100;
const MAX_RESOLUTION_NOTE_LENGTH = 1_000;

type HistoryRangeInput = { from?: string; to?: string };

export function normalizeHistoryRange(input: HistoryRangeInput, now = new Date()) {
  const to = input.to ? new Date(input.to) : now;
  const from = input.from ? new Date(input.from) : new Date(to.getTime() - 7 * DAY_MS);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
    return { ok: false as const, code: "INVALID_RANGE" as const };
  }

  const duration = to.getTime() - from.getTime();
  if (duration > MAX_HISTORY_DAYS * DAY_MS) {
    return { ok: false as const, code: "RANGE_TOO_WIDE" as const };
  }

  return {
    ok: true as const,
    from: from.toISOString(),
    to: to.toISOString(),
    days: Math.ceil(duration / DAY_MS),
  };
}

export function normalizeHistorySearch(value?: string) {
  const text = value?.trim() ?? "";
  return text.length <= MAX_SEARCH_LENGTH
    ? { ok: true as const, text }
    : { ok: false as const, code: "INVALID_SEARCH" as const };
}

export function validateResolutionNote(value?: string) {
  const note = value?.trim() || null;
  return !note || note.length <= MAX_RESOLUTION_NOTE_LENGTH
    ? { ok: true as const, note }
    : { ok: false as const, code: "INVALID_NOTE" as const };
}
