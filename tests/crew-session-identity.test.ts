import { describe, expect, it } from "vitest";
import {
  createSessionStorageAdapter,
  readCrewSessionIdentity,
  removeCrewSessionIdentity,
  writeCrewSessionIdentity,
} from "../src/lib/crew-session-identity";

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

describe("crew session identity", () => {
  it("round-trips only normalized validated identity", () => {
    const session = storage();
    const identity = { displayName: "  Crew   Pagi ", normalizedName: "ignored" };

    expect(writeCrewSessionIdentity(session, identity)).toEqual({
      displayName: "Crew Pagi",
      normalizedName: "crew pagi",
    });
    expect(readCrewSessionIdentity(session)).toEqual({
      displayName: "Crew Pagi",
      normalizedName: "crew pagi",
    });
  });

  it("removes malformed, mismatched, and invalid stored identity", () => {
    for (const value of [
      "{",
      JSON.stringify({ displayName: "", normalizedName: "" }),
      JSON.stringify({ displayName: "Crew", normalizedName: "other" }),
    ]) {
      const session = storage({ "table-talker.crew-identity": value });
      expect(readCrewSessionIdentity(session)).toBeNull();
      expect(session.getItem("table-talker.crew-identity")).toBeNull();
    }
  });

  it("fails open when storage access throws", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(readCrewSessionIdentity(unavailable)).toBeNull();
    expect(
      writeCrewSessionIdentity(unavailable, { displayName: "Crew", normalizedName: "crew" }),
    ).toBeNull();
    expect(() => removeCrewSessionIdentity(unavailable)).not.toThrow();
  });

  it("keeps each session adapter isolated", () => {
    const first = createSessionStorageAdapter(storage());
    const second = createSessionStorageAdapter(storage());

    first.setItem("supabase.auth.token", "same-tab-user");
    expect(first.getItem("supabase.auth.token")).toBe("same-tab-user");
    expect(second.getItem("supabase.auth.token")).toBeNull();
  });
});
