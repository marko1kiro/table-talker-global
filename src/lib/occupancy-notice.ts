export type OccupancyKind = "occupied" | "cleared" | "escorted" | "cancelled";
export type OccupancyActorRole = "kasir" | "clear_up" | "satgas" | "qr_scan";

export type OccupancyBroadcast = {
  table_number: number;
  revision: number;
  kind: OccupancyKind;
  actor_role: OccupancyActorRole;
  actor_name: string | null;
  actor_role_session_id: string | null;
};

export type OccupancyNotice = { line1: string; roleLabel: string; actorName: string | null };

const KIND_LINE1: Record<OccupancyKind, string> = {
  occupied: "TERISI",
  cleared: "SUDAH DIBERSIHKAN",
  escorted: "DIESCORT",
  cancelled: "DIBATALKAN",
};

export const ROLE_PILL_LABEL: Record<OccupancyActorRole, string> = {
  kasir: "KASIR",
  clear_up: "CLEAR UP",
  satgas: "SATGAS",
  qr_scan: "SCAN QR",
};

const KINDS = new Set<string>(Object.keys(KIND_LINE1));
const ROLES = new Set<string>(Object.keys(ROLE_PILL_LABEL));

export function parseOccupancyBroadcast(message: unknown): OccupancyBroadcast | null {
  if (!message || typeof message !== "object") return null;
  const payload = (message as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.table_number !== "number" || !Number.isInteger(p.table_number)) return null;
  if (typeof p.revision !== "number" || !Number.isSafeInteger(p.revision)) return null;
  if (typeof p.kind !== "string" || !KINDS.has(p.kind)) return null;
  if (typeof p.actor_role !== "string" || !ROLES.has(p.actor_role)) return null;
  return {
    table_number: p.table_number,
    revision: p.revision,
    kind: p.kind as OccupancyKind,
    actor_role: p.actor_role as OccupancyActorRole,
    actor_name: typeof p.actor_name === "string" ? p.actor_name : null,
    actor_role_session_id:
      typeof p.actor_role_session_id === "string" ? p.actor_role_session_id : null,
  };
}

export function formatOccupancyNotice(b: OccupancyBroadcast): OccupancyNotice | null {
  const head = KIND_LINE1[b.kind];
  const roleLabel = ROLE_PILL_LABEL[b.actor_role];
  if (!head || !roleLabel) return null;
  return { line1: `MEJA ${b.table_number} ${head}`, roleLabel, actorName: b.actor_name };
}
