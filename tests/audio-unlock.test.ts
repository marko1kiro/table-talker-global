import { describe, expect, it, vi } from "vitest";
import {
  createAudioPlaybackController,
  getBundledAudioUrl,
  getUnlockAudioUrl,
  unlockBundledAudio,
} from "../src/lib/audio";

function audioMock() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    muted: false,
    volume: 0.7,
    currentTime: 4,
    src: "",
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn((name: string, listener: () => void) =>
      (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(listener),
    ),
    removeEventListener: vi.fn((name: string, listener: () => void) =>
      listeners.get(name)?.delete(listener),
    ),
    emit: (name: string) => listeners.get(name)?.forEach((listener) => listener()),
  };
}

describe("bundled audio playback", () => {
  it("exposes real bundled sources", () => {
    expect(getUnlockAudioUrl).toBeTypeOf("function");
    expect(getBundledAudioUrl).toBeTypeOf("function");
  });

  it("reuses supplied audio for muted unlock and restores its settings", async () => {
    const audio = audioMock();
    await expect(unlockBundledAudio(audio, "/audio.mp3")).resolves.toBe(true);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.7);
    expect(audio.src).toBe("");
  });

  it("resets after manual ended and reuses one controller for remote", async () => {
    const audio = audioMock();
    const ended = vi.fn();
    const controller = createAudioPlaybackController(audio, ended);
    const manual = controller.play("/manual.mp3");
    audio.emit("playing");
    await manual;
    audio.emit("ended");
    expect(ended).toHaveBeenCalledOnce();
    expect(audio.src).toBe("");
    const remote = controller.play("/remote.mp3");
    audio.emit("playing");
    await remote;
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe("/remote.mp3");
  });

  it("rejects a pending start when stopped and removes listeners", async () => {
    const audio = audioMock();
    const controller = createAudioPlaybackController(audio);
    const pending = controller.play("/audio.mp3");
    controller.stop();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(audio.removeEventListener).toHaveBeenCalledTimes(3);
  });
});
