export const TABLE_COUNT = 70;
export const HEARTBEAT_MS = 10_000;
export const ONLINE_WINDOW_MS = 30_000;
export const COMMAND_TTL_MS = 5_000;
export const FAILURE_REASON_MAX_LENGTH = 160;

export const ANNOUNCEMENT_CATALOG = [
  { id: "seating", label: "Himbauan Duduk Sesuai Nomor Meja" },
  {
    id: "himbauan-barang-bawaan-pelanggan",
    label: "Himbauan Barang Bawaan Pelanggan",
  },
  { id: "outside-food", label: "Dilarang Bawa Makanan Dari Luar" },
  { id: "no-smoking", label: "Dilarang Merokok di Area Lobby" },
  { id: "larangan-gabung-meja", label: "Dilarang Gabungkan Meja" },
  { id: "jam-buka-resto", label: "Informasi Jam Buka Tutup Resto" },
] as const;

export type AnnouncementId = (typeof ANNOUNCEMENT_CATALOG)[number]["id"];
export type AudioId = `table:${number}` | `announcement:${AnnouncementId}`;
export type CatalogMetadata = { id: AudioId; label: string };
export type RemoteCommand = {
  id: string;
  targetSessionId: string;
  audioId: AudioId;
  createdAt: string;
  expiresAt: string;
};
export type CrewSessionEligibility = {
  connectionState: "connected" | "disconnected";
  visibilityState: "visible" | "hidden";
  audioReady: boolean;
  lastSeen: string;
};

export function getCatalogMetadata(id: string): CatalogMetadata | null {
  const table = /^table:([1-9][0-9]*)$/.exec(id);
  if (table && Number(table[1]) <= TABLE_COUNT)
    return { id: id as AudioId, label: `Meja ${table[1]}` };
  const announcement = ANNOUNCEMENT_CATALOG.find((item) => `announcement:${item.id}` === id);
  return announcement ? { id: `announcement:${announcement.id}`, label: announcement.label } : null;
}

export function normalizeCrewName(
  value: string,
): { displayName: string; normalizedName: string } | { error: string } {
  const displayName = value.trim().replace(/\s+/g, " ");
  if (!displayName) return { error: "Nama wajib diisi." };
  if (displayName.length > 40) return { error: "Nama maksimal 40 karakter." };
  if (!/^[\p{L}\p{N} .,'-]+$/u.test(displayName))
    return { error: "Nama berisi karakter yang tidak didukung." };
  return { displayName, normalizedName: displayName.toLocaleLowerCase("id-ID") };
}

export function sessionIsEligible(session: CrewSessionEligibility, now: number): boolean {
  const seen = Date.parse(session.lastSeen);
  return (
    session.audioReady &&
    session.connectionState === "connected" &&
    session.visibilityState === "visible" &&
    Number.isFinite(seen) &&
    seen <= now &&
    now - seen <= ONLINE_WINDOW_MS
  );
}

export function commandIsProcessable(
  command: RemoteCommand,
  sessionId: string,
  processedIds: ReadonlySet<string>,
  newestCreatedAt: string | null,
  now: number,
): boolean {
  const created = Date.parse(command.createdAt);
  const expires = Date.parse(command.expiresAt);
  return (
    command.targetSessionId === sessionId &&
    !processedIds.has(command.id) &&
    Number.isFinite(created) &&
    created <= now &&
    Number.isFinite(expires) &&
    expires > now &&
    (!newestCreatedAt || created > Date.parse(newestCreatedAt))
  );
}

export function boundedFailureReason(error: unknown): string {
  return (error instanceof Error ? error.message : "Pemutaran audio gagal.").slice(
    0,
    FAILURE_REASON_MAX_LENGTH,
  );
}
