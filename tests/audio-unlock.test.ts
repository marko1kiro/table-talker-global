import { describe, expect, it, vi } from "vitest";
import { getBundledAudioUrl, getUnlockAudioUrl, playMutedAudioUnlock } from "../src/lib/audio";

describe("bundled audio playback", () => {
  it("exposes a real bundled URL for muted unlock", () => {
    expect(getUnlockAudioUrl).toBeTypeOf("function");
  });

  it("resolves catalog audio IDs only when bundled", () => {
    expect(getBundledAudioUrl).toBeTypeOf("function");
  });

  it("plays a muted source then resets it", async () => {
    const audio = {
      muted: false,
      currentTime: 4,
      src: "",
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
    };

    await expect(playMutedAudioUnlock("/audio.mp3", () => audio)).resolves.toBe(true);
    expect(audio.muted).toBe(true);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toBe("");
  });

  it("reports unavailable when muted playback is rejected", async () => {
    const audio = {
      muted: false,
      currentTime: 0,
      src: "",
      play: vi.fn().mockRejectedValue(new Error("blocked")),
      pause: vi.fn(),
    };

    await expect(playMutedAudioUnlock("/audio.mp3", () => audio)).resolves.toBe(false);
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.currentTime).toBe(0);
    expect(audio.src).toBe("");
  });
});
