export const TABLE_COUNT = 100;

export const TABLE_AUDIO_IDS = Array.from(
  { length: TABLE_COUNT },
  (_, index) => `table:${index + 1}` as `table:${number}`,
);

export const ANNOUNCEMENT_CATALOG = [
  { id: "seating", label: "Himbauan Duduk Sesuai Nomor Meja", category: "INFO" },
  {
    id: "himbauan-barang-bawaan-pelanggan",
    label: "Himbauan Barang Bawaan Pelanggan",
    category: "INFO",
  },
  { id: "jam-buka-resto", label: "Informasi Jam Buka Tutup Resto", category: "INFO" },
  { id: "outside-food", label: "Dilarang Bawa Makanan Dari Luar", category: "LARANGAN" },
  { id: "no-smoking", label: "Dilarang Merokok di Area Lobby", category: "LARANGAN" },
  { id: "larangan-gabung-meja", label: "Dilarang Gabungkan Meja", category: "LARANGAN" },
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATALOG)[number]["category"];
export const HEARTBEAT_MS = 10_000;
export const ONLINE_WINDOW_MS = 30_000;
export const RECENT_WINDOW_MS = 3 * 60 * 60 * 1_000;
export type CrewSessionState = "online" | "recent" | "expired";
export const COMMAND_TTL_MS = 5_000;
export const FAILURE_REASON_MAX_LENGTH = 160;

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
export type CommandWatermark = Pick<RemoteCommand, "createdAt" | "id">;
export type CrewSessionEligibility = {
  connectionState: "connecting" | "connected" | "disconnected";
  visibilityState: "visible" | "hidden";
  audioReady: boolean;
  lastSeen: string;
};

export function getCatalogMetadata(id: string): CatalogMetadata | null {
  const table = TABLE_AUDIO_IDS.find((tableId) => tableId === id);
  if (table) return { id: table, label: `Meja ${table.slice("table:".length)}` };
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

export function classifyCrewSession(
  session: Omit<CrewSessionEligibility, "audioReady">,
  now: number,
): CrewSessionState {
  const seen = Date.parse(session.lastSeen);
  if (!Number.isFinite(seen) || seen > now || now - seen > RECENT_WINDOW_MS) return "expired";
  return session.connectionState === "connected" &&
    session.visibilityState === "visible" &&
    now - seen <= ONLINE_WINDOW_MS
    ? "online"
    : "recent";
}

export function commandIsProcessable(
  command: RemoteCommand,
  sessionId: string,
  processedIds: ReadonlySet<string>,
  newest: CommandWatermark | null,
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
    (!newest ||
      created > Date.parse(newest.createdAt) ||
      (created === Date.parse(newest.createdAt) && command.id > newest.id))
  );
}

export function boundedFailureReason(error: unknown): string {
  return (error instanceof Error ? error.message : "Pemutaran audio gagal.").slice(
    0,
    FAILURE_REASON_MAX_LENGTH,
  );
}
