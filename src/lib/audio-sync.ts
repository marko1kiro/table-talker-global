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
  message?: string;
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
): Promise<Map<string, CachedMeta>> {
  const meta = new Map<string, CachedMeta>();
  if (typeof caches === "undefined") return meta;

  try {
    const cache = await caches.open(cacheName);
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
  restaurantId: string,
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
): Promise<SyncResult> {
  if (typeof caches === "undefined") {
    return { ok: false, cachedCount: 0, downloadedCount: 0, failedIds: [], message: "Cache Storage tidak tersedia. Gunakan browser modern untuk sinkronisasi audio." };
  }
  if (!globalThis.crypto?.subtle) {
    return { ok: false, cachedCount: 0, downloadedCount: 0, failedIds: [], message: "Web Crypto tidak tersedia. Gunakan browser modern untuk verifikasi audio." };
  }
  if (manifest.length === 0) {
    return { ok: false, cachedCount: 0, downloadedCount: 0, failedIds: [], message: "Manifest audio kosong. Hubungi admin restoran." };
  }

  const cached = await getCachedMetadata(restaurantId, cacheName);

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
  const failedIds = new Set<string>();

  for (let i = 0; i < needsDownload.length; i += CONCURRENT) {
    const batch = needsDownload.slice(i, i + CONCURRENT);
    const results = await Promise.allSettled(
      batch.map(async (item) => {
        onProgress?.({ current: cachedCount + downloadedCount, total, label: item.label });
        const buffer = await downloadAndVerify(item.r2Url, item.contentHash, item.byteSize);
        if (!buffer) {
          failedIds.add(item.audioId);
          return;
        }
        const ok = await putToCache(restaurantId, item.audioId, buffer, item.contentHash, cacheName);
        if (!ok) {
          failedIds.add(item.audioId);
          return;
        }
        downloadedCount++;
      }),
    );

    if (results.some((r) => r.status === "rejected")) {
      batch.forEach((item) => failedIds.add(item.audioId));
    }
  }

  if (failedIds.size === 0) {
    const manifestIds = new Set(manifest.map((m) => m.audioId));
    const staleIds = Array.from(cached.keys()).filter((id) => !manifestIds.has(id));
    if (staleIds.length > 0) await removeFromCache(restaurantId, staleIds, cacheName);
  }

  onProgress?.({ current: total, total, label: "Selesai" });

  return {
    ok: failedIds.size === 0,
    cachedCount,
    downloadedCount,
    failedIds: [...failedIds],
  };
}

type CachedAudioUrlDependencies = {
  getCachedAudio?: typeof getCachedAudio;
  createObjectURL?: (blob: Blob) => string;
};

export async function getCachedAudioUrl(
  restaurantId: string,
  audioId: string,
  { getCachedAudio: readAudio = getCachedAudio, createObjectURL = URL.createObjectURL }: CachedAudioUrlDependencies = {},
): Promise<string | null> {
  const buffer = await readAudio(restaurantId, audioId);
  return buffer ? createObjectURL(new Blob([buffer], { type: "audio/mpeg" })) : null;
}
