import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  computeHash,
  syncManifest,
  getCachedMetadata,
  putToCache,
  getCachedAudio,
  removeFromCache,
  createSyncRunGate,
} from "../src/lib/audio-sync";

const TABLE_1_DATA = new Uint8Array(1024).fill(1);
const TABLE_2_DATA = new Uint8Array(2048).fill(2);

let table1Hash = "";
let table2Hash = "";

const manifest = [
  {
    audioId: "table:1",
    label: "Meja 1",
    category: "BASE",
    r2Url: "https://r2.example/1.mp3",
    contentHash: "",
    byteSize: 1024,
  },
  {
    audioId: "table:2",
    label: "Meja 2",
    category: "BASE",
    r2Url: "https://r2.example/2.mp3",
    contentHash: "",
    byteSize: 2048,
  },
];

function setupCaches() {
  const store = new Map<string, Response>();

  const cache = {
    put: vi.fn(async (req: Request, res: Response) => {
      store.set(req.url, res);
    }),
    match: vi.fn(async (req: Request) => store.get(req.url) ?? null),
    delete: vi.fn(async (req: Request) => {
      store.delete(req.url);
      return true;
    }),
    keys: vi.fn(async () => Array.from(store.keys()).map((url) => new Request(url))),
    add: vi.fn(),
    addAll: vi.fn(),
    matchAll: vi.fn(),
  };

  globalThis.caches = {
    open: vi.fn(async () => cache as unknown as Cache),
  } as unknown as CacheStorage;

  return { store, cache };
}

describe("audio-sync", () => {
  beforeEach(async () => {
    // @ts-expect-error delete
    delete globalThis.caches;
    table1Hash = await computeHash(TABLE_1_DATA.buffer);
    table2Hash = await computeHash(TABLE_2_DATA.buffer);
    manifest[0].contentHash = table1Hash;
    manifest[1].contentHash = table2Hash;
  });

  it("computeHash produces consistent SHA-256 hex", async () => {
    const buf = new TextEncoder().encode("hello");
    const h1 = await computeHash(buf.buffer);
    const h2 = await computeHash(buf.buffer);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects stale sync runs after tenant changes", () => {
    const runs = createSyncRunGate();
    const tenantARun = runs.start();
    const tenantBRun = runs.start();

    expect(runs.isCurrent(tenantARun)).toBe(false);
    expect(runs.isCurrent(tenantBRun)).toBe(true);
  });

  it("getCachedMetadata returns empty map when caches unavailable", async () => {
    const meta = await getCachedMetadata("restaurant-a");
    expect(meta.size).toBe(0);
  });

  it("getCachedMetadata reads stored metadata", async () => {
    setupCaches();
    const meta = await getCachedMetadata("restaurant-a");
    // Empty store
    expect(meta.size).toBe(0);
  });

  it("putToCache namespaces cache entries by restaurant", async () => {
    const { cache } = setupCaches();
    const buf = new ArrayBuffer(100);
    const ok = await putToCache("restaurant-a", "table:1", buf, "hash123");
    expect(ok).toBe(true);
    expect(cache.put).toHaveBeenCalled();
    expect(cache.put.mock.calls[0][0].url).toContain("/restaurant-a/audio/table%3A1");
  });

  it("getCachedAudio requires matching restaurant and audio ID", async () => {
    setupCaches();
    await putToCache("restaurant-a", "table:1", TABLE_1_DATA.buffer, "hash123");

    expect(await getCachedAudio("restaurant-a", "table:1")).toEqual(TABLE_1_DATA.buffer);
    const buf = await getCachedAudio("restaurant-b", "table:1");
    expect(buf).toBeNull();
  });

  it("removeFromCache deletes stale entries", async () => {
    const { cache } = setupCaches();
    await removeFromCache("restaurant-a", ["table:1", "table:2"]);
    expect(cache.delete).toHaveBeenCalledTimes(2);
  });

  describe("syncManifest", () => {
    it("returns cachedCount=0 and downloads all when cache empty", async () => {
      setupCaches();

      globalThis.fetch = vi.fn(async (url: string) => {
        const data = url.includes("1.mp3") ? TABLE_1_DATA : TABLE_2_DATA;
        return new Response(data.buffer.slice(0), { status: 200 });
      }) as never;

      const onProgress = vi.fn();
      const result = await syncManifest("restaurant-a", manifest, onProgress, "test-cache");

      expect(result.ok).toBe(true);
      expect(result.cachedCount).toBe(0);
      expect(result.downloadedCount).toBe(2);
      expect(result.failedIds).toHaveLength(0);
    });

    it("skips download when cache matches hash and size", async () => {
      const { cache } = setupCaches();

      // Pre-populate cache
      for (const item of manifest) {
        const buf = new Uint8Array(item.byteSize);
        const res = new Response(buf.buffer, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": String(item.byteSize),
            "x-content-hash": item.contentHash,
          },
        });
        await cache.put(
          new Request(
            `https://static.table-talker.local/restaurant-a/audio/${encodeURIComponent(item.audioId)}`,
          ),
          res,
        );
      }

      globalThis.fetch = vi.fn() as never;

      const result = await syncManifest("restaurant-a", manifest, undefined, "test-cache");

      expect(result.ok).toBe(true);
      expect(result.cachedCount).toBe(2);
      expect(result.downloadedCount).toBe(0);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it("reports failed items when download fails", async () => {
      setupCaches();

      let callCount = 0;
      globalThis.fetch = vi.fn(async () => {
        callCount++;
        if (callCount <= 6) {
          // Exhaust all retries for both items
          return new Response(null, { status: 500 });
        }
        return new Response(new Uint8Array(1024).buffer, { status: 200 });
      }) as never;

      const result = await syncManifest("restaurant-a", manifest, undefined, "test-cache");

      expect(result.ok).toBe(false);
      expect(result.failedIds.length).toBeGreaterThan(0);
      expect(new Set(result.failedIds).size).toBe(result.failedIds.length);
    });

    it("reports progress via callback", async () => {
      setupCaches();

      globalThis.fetch = vi.fn(async (url: string) => {
        const data = url.includes("1.mp3") ? TABLE_1_DATA : TABLE_2_DATA;
        return new Response(data.buffer.slice(0), { status: 200 });
      }) as never;

      const onProgress = vi.fn();
      await syncManifest("restaurant-a", manifest, onProgress, "test-cache");

      expect(onProgress).toHaveBeenCalled();
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
      expect(lastCall.current).toBe(lastCall.total);
    });

    it("blocks with actionable error when Cache Storage or Web Crypto is unavailable", async () => {
      setupCaches();
      const cacheStorage = globalThis.caches;
      // @ts-expect-error test unavailable Cache Storage
      delete globalThis.caches;
      expect((await syncManifest("restaurant-a", manifest)).message).toMatch(/Cache Storage/i);
      globalThis.caches = cacheStorage;

      const subtle = globalThis.crypto.subtle;
      Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: undefined });
      expect((await syncManifest("restaurant-a", manifest)).message).toMatch(/Web Crypto/i);
      Object.defineProperty(globalThis.crypto, "subtle", { configurable: true, value: subtle });
    });

    it("keeps obsolete entries when new manifest validation fails", async () => {
      const { store } = setupCaches();
      await putToCache(
        "restaurant-a",
        "table:stale",
        TABLE_1_DATA.buffer,
        table1Hash,
        "test-cache",
      );
      globalThis.fetch = vi.fn(async () => new Response(null, { status: 500 })) as never;

      await syncManifest("restaurant-a", manifest, undefined, "test-cache");

      expect([...store.keys()].some((key) => key.includes("table%3Astale"))).toBe(true);
    });
  });
});
