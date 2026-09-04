import { describe, expect, it } from "vitest";
import {
  readStoredTheme,
  writeStoredTheme,
  THEME_STORAGE_KEY,
} from "../src/components/dashboard/use-theme";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe("use-theme storage helpers", () => {
  it("defaults to light when nothing stored or storage missing", () => {
    expect(readStoredTheme(null)).toBe("light");
    expect(readStoredTheme(fakeStorage())).toBe("light");
  });
  it("reads a stored dark value", () => {
    expect(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: "dark" }))).toBe("dark");
  });
  it("writes the chosen theme under the key", () => {
    const s = fakeStorage();
    writeStoredTheme(s, "dark");
    expect(s.map.get(THEME_STORAGE_KEY)).toBe("dark");
  });
  it("swallows storage that throws (private mode)", () => {
    const boom = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readStoredTheme(boom)).toBe("light");
    expect(() => writeStoredTheme(boom, "dark")).not.toThrow();
  });
});
