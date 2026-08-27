import { describe, expect, it, vi } from "vitest";
import { createCachedAudioUrlPool, getCachedAudioUrl } from "../src/lib/audio-sync";

const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;

describe("cached playback", () => {
  it("creates playback URL only from tenant-scoped verified cache", async () => {
    const getCachedAudio = vi.fn(async (restaurantId: string, audioId: string) =>
      restaurantId === "restaurant-a" && audioId === "table:1" ? arrayBuffer : null,
    );
    const createObjectURL = vi.fn(() => "blob:cached-audio");

    await expect(
      getCachedAudioUrl("restaurant-a", "table:1", { getCachedAudio, createObjectURL }),
    ).resolves.toBe("blob:cached-audio");
    await expect(
      getCachedAudioUrl("restaurant-b", "table:1", { getCachedAudio, createObjectURL }),
    ).resolves.toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("memoizes object URLs so repeat playback avoids Cache Storage reads", async () => {
    const getCachedAudio = vi.fn(async () => arrayBuffer);
    const createObjectURL = vi.fn(() => "blob:warmed-audio");
    const pool = createCachedAudioUrlPool({ getCachedAudio, createObjectURL });

    await expect(pool.get("restaurant-a", "table:1")).resolves.toBe("blob:warmed-audio");
    await expect(pool.get("restaurant-a", "table:1")).resolves.toBe("blob:warmed-audio");

    expect(getCachedAudio).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent cache reads for the same audio", async () => {
    let resolveRead: ((value: ArrayBuffer) => void) | undefined;
    const getCachedAudio = vi.fn(
      () =>
        new Promise<ArrayBuffer>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const pool = createCachedAudioUrlPool({
      getCachedAudio,
      createObjectURL: () => "blob:shared",
    });

    const first = pool.get("restaurant-a", "table:1");
    const second = pool.get("restaurant-a", "table:1");
    resolveRead?.(arrayBuffer);

    await expect(Promise.all([first, second])).resolves.toEqual(["blob:shared", "blob:shared"]);
    expect(getCachedAudio).toHaveBeenCalledTimes(1);
  });

  it("preloads audio and revokes every pooled URL when cleared", async () => {
    const getCachedAudio = vi.fn(async () => arrayBuffer);
    const createObjectURL = vi
      .fn<(blob: Blob) => string>()
      .mockReturnValueOnce("blob:table-1")
      .mockReturnValueOnce("blob:table-2");
    const revokeObjectURL = vi.fn();
    const pool = createCachedAudioUrlPool({
      getCachedAudio,
      createObjectURL,
      revokeObjectURL,
    });

    await pool.preload("restaurant-a", ["table:1", "table:2"]);
    expect(getCachedAudio).toHaveBeenCalledTimes(2);

    pool.clear();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:table-1");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:table-2");
  });
});
