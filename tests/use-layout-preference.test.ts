import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  layoutPreferenceKey,
  readLayoutPreference,
  writeLayoutPreference,
} from "../src/lib/use-layout-preference";

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("layoutPreferenceKey", () => {
  it("uses the table-talker.layout.{role} key shape", () => {
    expect(layoutPreferenceKey("kasir")).toBe("table-talker.layout.kasir");
    expect(layoutPreferenceKey("satgas")).toBe("table-talker.layout.satgas");
    expect(layoutPreferenceKey("clear_up")).toBe("table-talker.layout.clear_up");
  });
});

describe("readLayoutPreference", () => {
  it('defaults to "grid" when localStorage is empty', () => {
    expect(readLayoutPreference("kasir", storage())).toBe("grid");
  });

  // Task 12 (Clear Up): per the plan, list is the natural default for
  // this role specifically -- Clear Up only ever cares about the
  // currently-TERISI subset of tables, which reads more naturally as a
  // sorted list than a mostly-empty grid. Kasir/Satgas are unaffected
  // (still default to grid, asserted above/below).
  it('defaults to "list" for clear_up specifically, when localStorage is empty', () => {
    expect(readLayoutPreference("clear_up", storage())).toBe("list");
  });

  it("still lets an explicit stored 'grid' choice override clear_up's list default", () => {
    const session = storage({ "table-talker.layout.clear_up": "grid" });
    expect(readLayoutPreference("clear_up", session)).toBe("grid");
  });

  it("reads back a persisted value", () => {
    const session = storage({ "table-talker.layout.kasir": "list" });
    expect(readLayoutPreference("kasir", session)).toBe("list");
  });

  it("falls back to grid for malformed/unknown stored values", () => {
    const session = storage({ "table-talker.layout.kasir": "garbage" });
    expect(readLayoutPreference("kasir", session)).toBe("grid");
  });

  it("falls back to clear_up's own default (list) for malformed/unknown stored values, not grid", () => {
    const session = storage({ "table-talker.layout.clear_up": "garbage" });
    expect(readLayoutPreference("clear_up", session)).toBe("list");
  });

  it("returns grid without throwing when storage is null", () => {
    expect(readLayoutPreference("kasir", null)).toBe("grid");
  });

  it("returns grid without throwing when storage.getItem throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLayoutPreference("kasir", throwing)).toBe("grid");
  });
});

describe("writeLayoutPreference", () => {
  it("persists a change that is then read back on next mount (same storage instance)", () => {
    const session = storage();
    writeLayoutPreference("kasir", "list", session);
    expect(readLayoutPreference("kasir", session)).toBe("list");
  });

  it("is scoped per role: Kasir's choice doesn't affect Satgas's", () => {
    const session = storage();
    writeLayoutPreference("kasir", "list", session);
    expect(readLayoutPreference("kasir", session)).toBe("list");
    expect(readLayoutPreference("satgas", session)).toBe("grid");
  });

  it("does nothing (does not throw) when storage is null", () => {
    expect(() => writeLayoutPreference("kasir", "list", null)).not.toThrow();
  });

  it("does not throw when storage.setItem throws", () => {
    const throwing = {
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writeLayoutPreference("kasir", "list", throwing)).not.toThrow();
  });
});

const hookSource = readFileSync(
  new URL("../src/lib/use-layout-preference.ts", import.meta.url),
  "utf8",
);

describe("useLayoutPreference hook source contract", () => {
  it("exports useLayoutPreference as a React hook backed by useState", () => {
    expect(hookSource).toContain("export function useLayoutPreference(");
    expect(hookSource).toContain("useState");
  });

  it("scopes storage per role via the table-talker.layout.{role} key shape", () => {
    expect(hookSource).toContain("table-talker.layout.");
  });

  it("reads from window.localStorage (device-persisted), not sessionStorage", () => {
    expect(hookSource).toContain("window.localStorage");
    expect(hookSource).not.toContain("sessionStorage");
  });
});
