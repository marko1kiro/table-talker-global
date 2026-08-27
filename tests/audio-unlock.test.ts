import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createAudioPlaybackController,
  getBundledAudioUrl,
  getUnlockAudioUrl,
  unlockBundledAudio,
  createPlaybackGeneration,
  runIfPlaybackCurrent,
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
    const manual = controller.play("/manual.mp3", 1);
    audio.emit("playing");
    await manual;
    audio.emit("ended");
    expect(ended).toHaveBeenCalledOnce();
    expect(audio.src).toBe("");
    const remote = controller.play("/remote.mp3", 2);
    audio.emit("playing");
    await remote;
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.src).toBe("/remote.mp3");
  });

  it("ignores a stale manual completion after remote replacement", () => {
    const generation = createPlaybackGeneration();
    const manual = generation.next();
    const remote = generation.next();
    expect(generation.isCurrent(manual)).toBe(false);
    expect(generation.isCurrent(remote)).toBe(true);
  });

  it("ignores a stale resumed-play rejection after remote replacement", async () => {
    const generation = createPlaybackGeneration();
    const resumed = generation.next();
    const remote = generation.next();
    const clearResumedState = vi.fn();
    await Promise.reject(new Error("resumed playback failed")).catch(() =>
      runIfPlaybackCurrent(generation, resumed, clearResumedState),
    );
    expect(generation.isCurrent(remote)).toBe(true);
    expect(clearResumedState).not.toHaveBeenCalled();
  });

  it("rejects a pending start when stopped and removes listeners", async () => {
    const audio = audioMock();
    const controller = createAudioPlaybackController(audio);
    const pending = controller.play("/audio.mp3", 1);
    controller.stop();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(audio.removeEventListener).toHaveBeenCalledTimes(3);
  });
});

it("keeps MP3 assets out of client source and unlocks with generated silent audio", () => {
  const source = readFileSync(new URL("../src/lib/audio.ts", import.meta.url), "utf8");
  expect(source).not.toContain("import.meta.glob");
  expect(source).not.toContain("assets/audio");
  expect(source).toContain("data:audio/wav;base64,");
  expect(source).toContain("getUnlockAudioUrl");
});

it("hydrates a same-tab crew after mount without persisting audio readiness", () => {
  const route = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  const hydrationEffect = route.match(
    /useEffect\(\(\) => \{\s*const identity = readCrewSessionIdentity\(browserSessionStorage\(\)\);[\s\S]*?\}, \[\]\);/,
  );

  expect(route).toContain("useState<CrewIdentity | null>(null)");
  expect(route).toContain("useState(false)");
  expect(hydrationEffect).not.toBeNull();
  expect(hydrationEffect?.[0]).toContain("audioReady: false");
  expect(hydrationEffect?.[0]).toContain("setIdentityHydrated(true)");
  expect(route).toContain("writeCrewSessionIdentity(browserSessionStorage(), identity)");
  expect(route).toContain("removeCrewSessionIdentity(browserSessionStorage())");
});

it("gates the crew dialog and remote registration until identity hydration completes", () => {
  const route = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );

  expect(route).toContain(
    "useRemoteCrew({\n    registration: identityHydrated ? crewIdentity : null,",
  );
  expect(route).toContain(
    "{identityHydrated && (\n        <CrewIdentityDialog\n          open={!crewIdentity}",
  );
});
