import type { ManifestItem } from "./restaurants.server";

const CACHE_NAME = "table-talker-audio-v1";
const CONCURRENT = 6;
const PRELOAD_CONCURRENT = 6;
const MAX_RETRIES = 3;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export type SyncProgress = {
  current: number;
  total: number;
  label: string;
};

export type DownloadFailureReason = "http" | "network" | "timeout" | "size" | "hash";
export type SyncFailureReason = DownloadFailureReason | "cache";

export type SyncResult = {
  ok: boolean;
  cachedCount: number;
  downloadedCount: number;
  failedIds: string[];
  message?: string;
  failureReason?: SyncFailureReason;
};

export type DownloadResult =
  | { ok: true; buffer: ArrayBuffer }
  | { ok: false; reason: DownloadFailureReason };

type DownloadOptions = {
  headers?: HeadersInit;
  retries?: number;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

type SyncOptions = {
  downloadHeaders?: HeadersInit;
  downloadTimeoutMs?: number;
};

type CachedMeta = {
  hash: string;
  byteSize: number;
};

export function createSyncRunGate() {
  let current = 0;
  return {
    start: () => ++current,
    isCurrent: (runId: number) => runId === current,
    cancel: () => ++current,
  };
}

function cacheKey(restaurantId: string, audioId: string) {
  return `https://static.table-talker.local/${encodeURIComponent(restaurantId)}/audio/${encodeURIComponent(audioId)}`;
}

export async function computeHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedMetadata(
  restaurantId: string,
  cacheName: string = CACHE_NAME,
  openedCache?: Cache,
): Promise<Map<string, CachedMeta>> {
  const meta = new Map<string, CachedMeta>();
  if (typeof caches === "undefined") return meta;

  try {
    const cache = openedCache ?? (await caches.open(cacheName));
    const keys = await cache.keys();
    for (const req of keys) {
      const url = new URL(req.url);
      const prefix = `/${encodeURIComponent(restaurantId)}/audio/`;
      if (!url.pathname.startsWith(prefix)) continue;
      const audioId = decodeURIComponent(url.pathname.slice(prefix.length));
      const res = await cache.match(req);
      if (!res) continue;
      meta.set(audioId, {
        hash: res.headers.get("x-content-hash") ?? "",
        byteSize: Number(res.headers.get("content-length") ?? 0),
      });
    }
  } catch {
    // Cache Storage unavailable
  }
  return meta;
}

export async function downloadAndVerify(
  url: string,
  expectedHash: string,
  expectedSize: number,
  {
    headers,
    retries = MAX_RETRIES,
    timeoutMs = DOWNLOAD_TIMEOUT_MS,
    fetcher = fetch,
  }: DownloadOptions = {},
): Promise<DownloadResult> {
  let lastReason: DownloadFailureReason = "network";

  for (let attempt = 0; attempt < retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetcher(url, { headers, signal: controller.signal });
      if (!res.ok) {
        lastReason = "http";
        continue;
      }
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength !== expectedSize) {
        lastReason = "size";
        continue;
      }
      const hash = await computeHash(buffer);
      if (hash !== expectedHash) {
        lastReason = "hash";
        continue;
      }
      return { ok: true, buffer };
    } catch (error) {
      lastReason =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
          ? "timeout"
          : "network";
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, reason: lastReason };
}

export async function putToCache(
  restaurantId: string,
  audioId: string,
  buffer: ArrayBuffer,
  hash: string,
  cacheName: string = CACHE_NAME,
  openedCache?: Cache,
): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = openedCache ?? (await caches.open(cacheName));
    const response = new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.byteLength),
        "x-content-hash": hash,
      },
    });
    await cache.put(new Request(cacheKey(restaurantId, audioId)), response);
    return true;
  } catch {
    return false;
  }
}

export async function getCachedAudio(
  restaurantId: string,
  audioId: string,
  cacheName: string = CACHE_NAME,
): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(cacheName);
    const res = await cache.match(new Request(cacheKey(restaurantId, audioId)));
    if (!res) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function removeFromCache(
  restaurantId: string,
  audioIds: string[],
  cacheName: string = CACHE_NAME,
): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(cacheName);
    for (const id of audioIds) {
      await cache.delete(new Request(cacheKey(restaurantId, id)));
    }
  } catch {
    // ignore
  }
}

export async function syncManifest(
  restaurantId: string,
  manifest: ManifestItem[],
  onProgress?: (progress: SyncProgress) => void,
  cacheName: string = CACHE_NAME,
  options: SyncOptions = {},
): Promise<SyncResult> {
  if (typeof caches === "undefined") {
    return {
      ok: false,
      cachedCount: 0,
      downloadedCount: 0,
      failedIds: [],
      message: "Cache Storage tidak tersedia. Gunakan browser modern untuk sinkronisasi audio.",
    };
  }
  if (!globalThis.crypto?.subtle) {
    return {
      ok: false,
      cachedCount: 0,
      downloadedCount: 0,
      failedIds: [],
      message: "Web Crypto tidak tersedia. Gunakan browser modern untuk verifikasi audio.",
    };
  }
  if (manifest.length === 0) {
    return {
      ok: false,
      cachedCount: 0,
      downloadedCount: 0,
      failedIds: [],
      message: "Manifest audio kosong. Hubungi admin restoran.",
    };
  }

  let openedCache: Cache;
  try {
    openedCache = await caches.open(cacheName);
  } catch {
    return {
      ok: false,
      cachedCount: 0,
      downloadedCount: 0,
      failedIds: [],
      message: "Cache Storage browser gagal dibuka. Kosongkan ruang penyimpanan lalu coba lagi.",
      failureReason: "cache",
    };
  }
  const cached = await getCachedMetadata(restaurantId, cacheName, openedCache);

  const needsDownload: ManifestItem[] = [];
  let cachedCount = 0;

  for (const item of manifest) {
    const existing = cached.get(item.audioId);
    if (existing && existing.hash === item.contentHash && existing.byteSize === item.byteSize) {
      cachedCount++;
    } else {
      needsDownload.push(item);
    }
  }

  const total = manifest.length;
  let downloadedCount = 0;
  let completedCount = 0;
  const failedIds = new Set<string>();
  const failureReasons = new Map<string, SyncFailureReason>();

  onProgress?.({ current: cachedCount, total, label: "Memulai unduhan..." });

  let nextDownloadIndex = 0;
  const downloadWorker = async () => {
    while (nextDownloadIndex < needsDownload.length) {
      const item = needsDownload[nextDownloadIndex++];
      try {
        const headers = new Headers(options.downloadHeaders);
        headers.set("X-Audio-Grant", item.downloadGrant);
        const download = await downloadAndVerify(
          item.downloadUrl,
          item.contentHash,
          item.byteSize,
          {
            headers,
            timeoutMs: options.downloadTimeoutMs,
          },
        );
        if (!download.ok) {
          failedIds.add(item.audioId);
          failureReasons.set(item.audioId, download.reason);
          continue;
        }
        const cachedOk = await putToCache(
          restaurantId,
          item.audioId,
          download.buffer,
          item.contentHash,
          cacheName,
          openedCache,
        );
        if (!cachedOk) {
          failedIds.add(item.audioId);
          failureReasons.set(item.audioId, "cache");
          continue;
        }
        downloadedCount++;
      } catch {
        failedIds.add(item.audioId);
        failureReasons.set(item.audioId, "network");
      } finally {
        completedCount++;
        onProgress?.({
          current: cachedCount + completedCount,
          total,
          label: item.label,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENT, needsDownload.length) }, downloadWorker),
  );

  if (failedIds.size === 0) {
    const manifestIds = new Set(manifest.map((m) => m.audioId));
    const staleIds = Array.from(cached.keys()).filter((id) => !manifestIds.has(id));
    if (staleIds.length > 0) await removeFromCache(restaurantId, staleIds, cacheName);
  }

  const failureReason = failureReasons.values().next().value;
  const ok = failedIds.size === 0;
  onProgress?.({ current: total, total, label: ok ? "Selesai" : "Pemeriksaan selesai" });

  return {
    ok,
    cachedCount,
    downloadedCount,
    failedIds: [...failedIds],
    failureReason,
    message: ok
      ? undefined
      : failureReason === "cache"
        ? "Cache Storage browser gagal menyimpan audio. Kosongkan ruang penyimpanan lalu coba lagi."
        : failureReason === "timeout" || failureReason === "network"
          ? `${failedIds.size} audio gagal diunduh. Periksa koneksi lalu coba lagi.`
          : `${failedIds.size} audio tidak dapat diverifikasi. Coba lagi atau hubungi admin.`,
  };
}

type CachedAudioUrlDependencies = {
  getCachedAudio?: typeof getCachedAudio;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

export async function getCachedAudioUrl(
  restaurantId: string,
  audioId: string,
  {
    getCachedAudio: readAudio = getCachedAudio,
    createObjectURL = URL.createObjectURL,
  }: CachedAudioUrlDependencies = {},
): Promise<string | null> {
  const buffer = await readAudio(restaurantId, audioId);
  return buffer ? createObjectURL(new Blob([buffer], { type: "audio/mpeg" })) : null;
}

export function createCachedAudioUrlPool({
  getCachedAudio: readAudio = getCachedAudio,
  createObjectURL = URL.createObjectURL,
  revokeObjectURL = URL.revokeObjectURL,
}: CachedAudioUrlDependencies = {}) {
  const urls = new Map<string, string>();
  const pending = new Map<string, Promise<string | null>>();
  let generation = 0;
  const keyFor = (restaurantId: string, audioId: string) => `${restaurantId}\u0000${audioId}`;

  const get = (restaurantId: string, audioId: string): Promise<string | null> => {
    const key = keyFor(restaurantId, audioId);
    const existing = urls.get(key);
    if (existing) return Promise.resolve(existing);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const loadGeneration = generation;
    const load = readAudio(restaurantId, audioId)
      .then((buffer) => {
        if (!buffer || generation !== loadGeneration) return null;
        const url = createObjectURL(new Blob([buffer], { type: "audio/mpeg" }));
        urls.set(key, url);
        return url;
      })
      .finally(() => {
        if (pending.get(key) === load) pending.delete(key);
      });
    pending.set(key, load);
    return load;
  };

  return {
    get,
    async preload(restaurantId: string, audioIds: readonly string[]) {
      for (let index = 0; index < audioIds.length; index += PRELOAD_CONCURRENT) {
        await Promise.all(
          audioIds
            .slice(index, index + PRELOAD_CONCURRENT)
            .map((audioId) => get(restaurantId, audioId)),
        );
      }
    },
    clear() {
      generation++;
      for (const url of urls.values()) revokeObjectURL(url);
      urls.clear();
      pending.clear();
    },
  };
}
