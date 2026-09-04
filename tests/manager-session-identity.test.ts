import { describe, expect, it } from "vitest";
import {
  MANAGER_SESSION_IDENTITY_KEY,
  readManagerIdentity,
  writeManagerIdentity,
  removeManagerIdentity,
  type ManagerIdentity,
} from "../src/lib/manager-session-identity";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

const identity: ManagerIdentity = {
  idManager: "budi",
  fullName: "Budi",
  restaurantId: "11111111-1111-1111-1111-111111111111",
  restaurantDisplayName: "Mie Gacoan Kampung Bulu",
  restaurantCode: "CKRBUL",
  managerToken: "tok",
  accessToken: "anon",
};

describe("manager session identity", () => {
  it("round-trips through storage", () => {
    const s = memoryStorage();
    writeManagerIdentity(s, identity);
    expect(s.getItem(MANAGER_SESSION_IDENTITY_KEY)).toBeTruthy();
    expect(readManagerIdentity(s)).toEqual(identity);
  });
  it("returns null and clears a malformed entry", () => {
    const s = memoryStorage();
    s.setItem(MANAGER_SESSION_IDENTITY_KEY, JSON.stringify({ idManager: "x" }));
    expect(readManagerIdentity(s)).toBeNull();
    expect(s.getItem(MANAGER_SESSION_IDENTITY_KEY)).toBeNull();
  });
  it("removeManagerIdentity clears the key", () => {
    const s = memoryStorage();
    writeManagerIdentity(s, identity);
    removeManagerIdentity(s);
    expect(readManagerIdentity(s)).toBeNull();
  });
});
