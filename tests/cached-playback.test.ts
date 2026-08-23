import { describe, expect, it, vi } from "vitest";
import { getCachedAudioUrl } from "../src/lib/audio-sync";

describe("cached playback", () => {
  it("creates playback URL only from tenant-scoped verified cache", async () => {
    const arrayBuffer = new Uint8Array([1, 2, 3]).buffer;
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
});
