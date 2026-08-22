import type { ManifestItem } from "./restaurants.server";

const CACHE_NAME = "table-talker-audio-v1";
const CONCURRENT = 2;
const MAX_RETRIES = 3;

export type SyncProgress = {
  current: number;
  total: number;
  label: string;
};

export type SyncResult = {
  ok: boolean;
  cachedCount: number;
  downloadedCount: number;
  failedIds: string[];
};

type CachedMeta = {
  hash: string;
  byteSize: number;
};

function cacheKey(audioId: string) {
  return `https://static.table-talker.local/audio/${encodeURIComponent(audioId)}`;
}

export async function computeHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getCachedMetadata(cacheName: string = CACHE_NAME): Promise<Map<string, CachedMeta>> {
  const meta = new Map<string, CachedMeta>();
  if (typeof caches === "undefined") return meta;

  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    for (const req of keys) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith("/audio/")) continue;
      const audioId = decodeURIComponent(url.pathname.slice("/audio/".length));
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
): Promise<ArrayBuffer | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buffer = await res.arrayBuffer();
      if (buffer.byteLength !== expectedSize) continue;
      const hash = await computeHash(buffer);
      if (hash !== expectedHash) continue;
      return buffer;
    } catch {
      // retry
    }
  }
  return null;
}

export async function putToCache(
  audioId: string,
  buffer: ArrayBuffer,
  hash: string,
  cacheName: string = CACHE_NAME,
): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(cacheName);
    const response = new Response(buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(buffer.byteLength),
        "x-content-hash": hash,
      },
    });
    await cache.put(new Request(cacheKey(audioId)), response);
    return true;
  } catch {
    return false;
  }
}

export async function getCachedAudio(
  audioId: string,
  cacheName: string = CACHE_NAME,
): Promise<ArrayBuffer | null> {
  if (typeof caches === "undefined") return null;
  try {
    const cache = await caches.open(cacheName);
    const res = await cache.match(new Request(cacheKey(audioId)));
    if (!res) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function removeFromCache(
  audioIds: string[],
  cacheName: string = CACHE_NAME,
): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open(cacheName);
    for (const id of audioIds) {
      await cache.delete(new Request(cacheKey(id)));
    }
  } catch {
    // ignore
  }
}

export async function syncManifest(
  manifest: ManifestItem[],
  onProgress?: (progress: SyncProgress) => void,
  cacheName: string = CACHE_NAME,
): Promise<SyncResult> {
  const cached = await getCachedMetadata(cacheName);

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
  const failedIds: string[] = [];

  for (let i = 0; i < needsDownload.length; i += CONCURRENT) {
    const batch = needsDownload.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        onProgress?.({ current: cachedCount + downloadedCount, total, label: item.label });
        const buffer = await downloadAndVerify(item.r2Url, item.contentHash, item.byteSize);
        if (!buffer) {
          failedIds.push(item.audioId);
          return;
        }
        const ok = await putToCache(item.audioId, buffer, item.contentHash, cacheName);
        if (!ok) {
          failedIds.push(item.audioId);
          return;
        }
        downloadedCount++;
      }),
    );

    if (results.some((r) => r.status === "rejected")) {
      failedIds.push(...batch.map((b) => b.audioId));
    }
  }

  // Remove obsolete cache entries
  const manifestIds = new Set(manifest.map((m) => m.audioId));
  const staleIds = Array.from(cached.keys()).filter((id) => !manifestIds.has(id));
  if (staleIds.length > 0) await removeFromCache(staleIds, cacheName);

  onProgress?.({ current: total, total, label: "Selesai" });

  return {
    ok: failedIds.length === 0,
    cachedCount,
    downloadedCount,
    failedIds,
  };
}
