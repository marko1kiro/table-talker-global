import { normalizeCrewName } from "./remote-audio-domain";

export const CREW_SESSION_IDENTITY_KEY = "table-talker.crew-identity";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CrewSessionIdentity = {
  displayName: string;
  normalizedName: string;
};

export function readCrewSessionIdentity(storage: StorageLike | null): CrewSessionIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CREW_SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { displayName?: unknown; normalizedName?: unknown };
    if (typeof value.displayName !== "string" || typeof value.normalizedName !== "string") {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
      return null;
    }
    const normalized = normalizeCrewName(value.displayName);
    if ("error" in normalized || normalized.normalizedName !== value.normalizedName) {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
      return null;
    }
    return normalized;
  } catch {
    try {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
    } catch {}
    return null;
  }
}

export function writeCrewSessionIdentity(
  storage: StorageLike | null,
  identity: CrewSessionIdentity,
): CrewSessionIdentity | null {
  const normalized = normalizeCrewName(identity.displayName);
  if ("error" in normalized || !storage) return null;
  try {
    storage.setItem(CREW_SESSION_IDENTITY_KEY, JSON.stringify(normalized));
    return normalized;
  } catch {
    return null;
  }
}

export function removeCrewSessionIdentity(storage: StorageLike | null) {
  try {
    storage?.removeItem(CREW_SESSION_IDENTITY_KEY);
  } catch {}
}

export function createSessionStorageAdapter(storage: StorageLike | null): StorageLike {
  return {
    getItem: (key) => {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage?.setItem(key, value);
      } catch {}
    },
    removeItem: (key) => {
      try {
        storage?.removeItem(key);
      } catch {}
    },
  };
}

export function browserSessionStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
