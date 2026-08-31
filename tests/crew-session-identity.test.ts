import { describe, expect, it } from "vitest";
import {
  createSessionStorageAdapter,
  readCrewSessionIdentity,
  readRoleSessionIdentity,
  removeCrewSessionIdentity,
  removeRoleSessionIdentity,
  writeCrewSessionIdentity,
  writeRoleSessionIdentity,
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
  const restaurantFields = {
    restaurantId: "test-restaurant-id",
    restaurantDisplayName: "Mie Gacoan Kampung Bulu",
    tenantToken: "signed-tenant-session",
    crewSessionId: "",
    crewSessionToken: "",
  };

  it("round-trips only normalized validated identity", () => {
    const session = storage();
    const identity = {
      displayName: "  Crew   Pagi ",
      normalizedName: "ignored",
      ...restaurantFields,
    };

    expect(writeCrewSessionIdentity(session, identity)).toEqual({
      displayName: "Crew Pagi",
      normalizedName: "crew pagi",
      ...restaurantFields,
    });
    expect(readCrewSessionIdentity(session)).toEqual({
      displayName: "Crew Pagi",
      normalizedName: "crew pagi",
      ...restaurantFields,
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
      writeCrewSessionIdentity(unavailable, {
        displayName: "Crew",
        normalizedName: "crew",
        ...restaurantFields,
      }),
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

// Task 8: a distinct, separately-keyed identity for the 3 non-SS roles
// (Kasir/Satgas/Clear Up), created via the new claim_role_session RPC.
// Deliberately never conflated with CrewSessionIdentity's crewSessionId/
// crewSessionToken fields (the SS-only, permanently-empty claim_crew_session
// fields, per Option B) -- kept as a fully separate storage key/shape.
describe("role session identity", () => {
  const roleFields = {
    restaurantId: "test-restaurant-id",
    restaurantDisplayName: "Mie Gacoan Kampung Bulu",
    tenantToken: "signed-tenant-session",
    role: "kasir" as const,
    displayName: "Budi",
    checkedInAt: "2026-08-30T02:00:00.000Z",
    roleSessionId: "role-session-1",
    roleSessionToken: "opaque-role-token",
    accessToken: "anon-access-token",
  };

  it("round-trips a valid role session identity under a distinct storage key", () => {
    const session = storage();
    expect(writeRoleSessionIdentity(session, roleFields)).toEqual(roleFields);
    expect(readRoleSessionIdentity(session)).toEqual(roleFields);
    expect(session.getItem("table-talker.crew-identity")).toBeNull();
  });

  it("removes malformed or invalid stored role identity", () => {
    for (const value of [
      "{",
      JSON.stringify({ ...roleFields, role: "owner" }),
      JSON.stringify({ ...roleFields, displayName: "" }),
    ]) {
      const session = storage({ "table-talker.role-identity": value });
      expect(readRoleSessionIdentity(session)).toBeNull();
      expect(session.getItem("table-talker.role-identity")).toBeNull();
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

    expect(readRoleSessionIdentity(unavailable)).toBeNull();
    expect(writeRoleSessionIdentity(unavailable, roleFields)).toBeNull();
    expect(() => removeRoleSessionIdentity(unavailable)).not.toThrow();
  });

  it("removes the role identity independently of the SS crew identity", () => {
    const session = storage({
      "table-talker.crew-identity": "should-not-be-touched",
    });
    writeRoleSessionIdentity(session, roleFields);
    removeRoleSessionIdentity(session);
    expect(readRoleSessionIdentity(session)).toBeNull();
    expect(session.getItem("table-talker.crew-identity")).toBe("should-not-be-touched");
  });
});
