import { normalizeCrewName } from "./remote-audio-domain";

export const CREW_SESSION_IDENTITY_KEY = "table-talker.crew-identity";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CrewSessionIdentity = {
  displayName: string;
  normalizedName: string;
  restaurantId: string;
  restaurantCode: string;
  restaurantDisplayName: string;
  tenantToken: string;
  crewSessionId: string;
  crewSessionToken: string;
};

export function readCrewSessionIdentity(storage: StorageLike | null): CrewSessionIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(CREW_SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as {
      displayName?: unknown;
      normalizedName?: unknown;
      restaurantId?: unknown;
      restaurantCode?: unknown;
      restaurantDisplayName?: unknown;
      tenantToken?: unknown;
    crewSessionId?: unknown;
      crewSessionToken?: unknown;
    };
    if (
      typeof value.displayName !== "string" ||
      typeof value.normalizedName !== "string" ||
      typeof value.restaurantId !== "string" ||
      typeof value.restaurantCode !== "string" ||
      typeof value.restaurantDisplayName !== "string" ||
      typeof value.tenantToken !== "string" ||
      !value.tenantToken ||
       typeof value.crewSessionId !== "string" ||
       typeof value.crewSessionToken !== "string"
    ) {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
      return null;
    }
    const normalized = normalizeCrewName(value.displayName);
    if ("error" in normalized || normalized.normalizedName !== value.normalizedName) {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
      return null;
    }
    return {
      ...normalized,
      restaurantId: value.restaurantId,
      restaurantCode: value.restaurantCode,
      restaurantDisplayName: value.restaurantDisplayName,
      tenantToken: value.tenantToken,
       crewSessionId: value.crewSessionId,
       crewSessionToken: value.crewSessionToken,
    };
  } catch {
    try {
      storage.removeItem(CREW_SESSION_IDENTITY_KEY);
    } catch {
      return null;
    }
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
    const data = {
      ...normalized,
      restaurantId: identity.restaurantId,
      restaurantCode: identity.restaurantCode,
      restaurantDisplayName: identity.restaurantDisplayName,
      tenantToken: identity.tenantToken,
       crewSessionId: identity.crewSessionId,
       crewSessionToken: identity.crewSessionToken,
    };
    storage.setItem(CREW_SESSION_IDENTITY_KEY, JSON.stringify(data));
    return data;
  } catch {
    return null;
  }
}

export function removeCrewSessionIdentity(storage: StorageLike | null) {
  try {
    storage?.removeItem(CREW_SESSION_IDENTITY_KEY);
  } catch {
    return;
  }
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
      } catch {
        return;
      }
    },
    removeItem: (key) => {
      try {
        storage?.removeItem(key);
      } catch {
        return;
      }
    },
  };
}

export function browserSessionStorage(): StorageLike | null {
  // sessionStorage survives reloads but is readable by XSS; token expiry limits exposure.
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
