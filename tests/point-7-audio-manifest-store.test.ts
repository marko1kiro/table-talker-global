// Poin 7 Task 1: manifest snapshot store — pure, no DOM, no network.
// localStorage is stubbed per-test (real jsdom storage would leak between files).
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearAudioSnapshot,
  decideAudioStartup,
  formatAudioAge,
  loadAudioSnapshot,
  saveAudioSnapshot,
  type AudioSnapshot,
} from "@/lib/audio-manifest-store";

const snap = (over: Partial<AudioSnapshot> = {}): AudioSnapshot => ({
  restaurantId: "resto-1",
  catalogVersion: 12,
  fetchedAt: 1_000_000,
  items: [{ audioId: "table:1", hash: "h1", size: 100 }],
  ...over,
});

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("snapshot round-trip", () => {
  test("save then load returns the same snapshot", () => {
    const s = memStorage();
    saveAudioSnapshot(snap(), { storage: s as Storage });
    expect(loadAudioSnapshot("resto-1", { storage: s as Storage })).toEqual(snap());
  });

  test("load ignores other restaurants", () => {
    const s = memStorage();
    saveAudioSnapshot(snap(), { storage: s as Storage });
    expect(loadAudioSnapshot("resto-2", { storage: s as Storage })).toBeNull();
  });

  test("corrupt JSON / wrong shape / empty items => null (fail-safe to first-ever)", () => {
    const s = memStorage({
      "lm.audio.manifest.v1:resto-1": "bukan-json{{{",
    });
    expect(loadAudioSnapshot("resto-1", { storage: s as Storage })).toBeNull();
    const s2 = memStorage();
    saveAudioSnapshot(snap({ items: [] }), { storage: s2 as Storage });
    expect(loadAudioSnapshot("resto-1", { storage: s2 as Storage })).toBeNull();
  });

  test("storage throwing (private mode) never throws", () => {
    const bad = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => saveAudioSnapshot(snap(), { storage: bad as unknown as Storage })).not.toThrow();
    expect(loadAudioSnapshot("resto-1", { storage: bad as unknown as Storage })).toBeNull();
    expect(() =>
      clearAudioSnapshot("resto-1", { storage: bad as unknown as Storage }),
    ).not.toThrow();
  });

  test("clear removes only that restaurant", () => {
    const s = memStorage();
    saveAudioSnapshot(snap(), { storage: s as Storage });
    saveAudioSnapshot(snap({ restaurantId: "resto-2" }), { storage: s as Storage });
    clearAudioSnapshot("resto-1", { storage: s as Storage });
    expect(loadAudioSnapshot("resto-1", { storage: s as Storage })).toBeNull();
    expect(loadAudioSnapshot("resto-2", { storage: s as Storage })).not.toBeNull();
  });
});

describe("decideAudioStartup", () => {
  test("no snapshot => first-ever (blocking allowed)", () => {
    expect(decideAudioStartup({ snapshot: null, fetched: null })).toBe("first-ever");
  });

  test("fetch failed + snapshot => offline", () => {
    expect(decideAudioStartup({ snapshot: snap(), fetched: null })).toBe("offline");
  });

  test("same version => current", () => {
    expect(decideAudioStartup({ snapshot: snap(), fetched: { version: 12 } })).toBe("current");
  });

  test("different version => stale", () => {
    expect(decideAudioStartup({ snapshot: snap(), fetched: { version: 13 } })).toBe("stale");
  });
});

describe("formatAudioAge", () => {
  const now = 10_000_000;
  test("compact Indonesian, single line, no wrapping words", () => {
    expect(formatAudioAge(now - 10_000, now)).toBe("baru saja");
    expect(formatAudioAge(now - 5 * 60_000, now)).toBe("5 mnt");
    expect(formatAudioAge(now - 2 * 3_600_000, now)).toBe("2 jam");
    expect(formatAudioAge(now - 3 * 86_400_000, now)).toBe("3 hr");
    expect(formatAudioAge(now + 60_000, now)).toBe("baru saja");
  });
});
