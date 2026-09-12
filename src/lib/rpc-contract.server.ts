// Reader for the durable jsonb verdict contract used by every mutating
// Poin 2 RPC: { ok: true, id? } | { ok: false, error: CODE }. A transport
// error or a malformed payload maps to the fallback code (UNAVAILABLE) so
// callers never read business meaning out of an undefined shape.
export type RpcVerdict = { ok: true; id?: string } | { ok: false; code: string };

export function readRpcVerdict(
  data: unknown,
  error: { message: string } | null,
  fallback = "UNAVAILABLE",
): RpcVerdict {
  if (error || typeof data !== "object" || data === null) return { ok: false, code: fallback };
  const raw = data as { ok?: unknown; error?: unknown; id?: unknown };
  if (raw.ok === true) {
    return typeof raw.id === "string" ? { ok: true, id: raw.id } : { ok: true };
  }
  if (typeof raw.error === "string" && raw.error !== "") return { ok: false, code: raw.error };
  return { ok: false, code: fallback };
}
