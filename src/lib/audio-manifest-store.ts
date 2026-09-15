// Poin 7: last-known-good manifest snapshot. localStorage only (tiny, sync
// read at boot), written ONLY after a fully hash-verified sync. Corrupt or
// empty snapshots read as absent so the flow falls back to first-ever sync.

export type AudioSnapshotItem = { audioId: string; hash: string; size: number };

export type AudioSnapshot = {
  restaurantId: string;
  catalogVersion: number;
  fetchedAt: number;
  items: AudioSnapshotItem[];
};

export type StoreDeps = { storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> };

const KEY_PREFIX = "lm.audio.manifest.v1:";

function keyFor(restaurantId: string): string {
  return `${KEY_PREFIX}${restaurantId}`;
}

function storageOf(deps: StoreDeps): Pick<Storage, "getItem" | "setItem" | "removeItem"> | null {
  if (deps.storage) return deps.storage;
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isSnapshot(value: unknown): value is AudioSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.restaurantId !== "string" || v.restaurantId.length === 0) return false;
  if (typeof v.catalogVersion !== "number" || !Number.isFinite(v.catalogVersion)) return false;
  if (typeof v.fetchedAt !== "number" || !Number.isFinite(v.fetchedAt)) return false;
  if (!Array.isArray(v.items) || v.items.length === 0) return false;
  return v.items.every(
    (it) =>
      typeof it === "object" &&
      it !== null &&
      typeof (it as Record<string, unknown>).audioId === "string" &&
      typeof (it as Record<string, unknown>).hash === "string" &&
      typeof (it as Record<string, unknown>).size === "number",
  );
}

export function saveAudioSnapshot(snapshot: AudioSnapshot, deps: StoreDeps = {}): void {
  const storage = storageOf(deps);
  if (!storage) return;
  try {
    storage.setItem(keyFor(snapshot.restaurantId), JSON.stringify(snapshot));
  } catch {
    // Private mode / quota: offline fallback simply unavailable. Never throw.
  }
}

export function loadAudioSnapshot(
  restaurantId: string,
  deps: StoreDeps = {},
): AudioSnapshot | null {
  const storage = storageOf(deps);
  if (!storage) return null;
  try {
    const raw = storage.getItem(keyFor(restaurantId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed) || parsed.restaurantId !== restaurantId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearAudioSnapshot(restaurantId: string, deps: StoreDeps = {}): void {
  const storage = storageOf(deps);
  if (!storage) return;
  try {
    storage.removeItem(keyFor(restaurantId));
  } catch {
    // Never throw on cleanup paths (logout must always succeed).
  }
}

export type FreshManifest = {
  version: number;
  items: { audioId: string; contentHash: string; byteSize: number }[];
};

export function snapshotFromFresh(
  restaurantId: string,
  fresh: FreshManifest,
  now: number = Date.now(),
): AudioSnapshot {
  return {
    restaurantId,
    catalogVersion: fresh.version,
    fetchedAt: now,
    items: fresh.items.map((it) => ({
      audioId: it.audioId,
      hash: it.contentHash,
      size: it.byteSize,
    })),
  };
}

export type StartupDecision = "first-ever" | "offline" | "current" | "stale";

export function decideAudioStartup(args: {
  snapshot: AudioSnapshot | null;
  fetched: { version: number } | null;
}): StartupDecision {
  if (!args.snapshot) return "first-ever";
  if (!args.fetched) return "offline";
  return args.fetched.version === args.snapshot.catalogVersion ? "current" : "stale";
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// Compact single-line age for the Profile dropdown (owner rule: responsive,
// never force long text). All outputs are one short token pair.
export function formatAudioAge(fetchedAt: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - fetchedAt);
  if (diff < MINUTE) return "baru saja";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} mnt`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} jam`;
  return `${Math.floor(diff / DAY)} hr`;
}
