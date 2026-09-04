// Manager analogue of crew-session-identity.ts. Persists the manager bearer
// token + the device's anon Supabase access token (needed for realtime) in
// sessionStorage. Token expiry limits XSS exposure (same rationale as crew).
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const MANAGER_SESSION_IDENTITY_KEY = "table-talker.manager-identity";

export type ManagerIdentity = {
  idManager: string;
  fullName: string;
  restaurantId: string;
  restaurantDisplayName: string;
  restaurantCode: string;
  managerToken: string;
  accessToken: string;
};

const REQUIRED_KEYS = [
  "idManager",
  "fullName",
  "restaurantId",
  "restaurantDisplayName",
  "restaurantCode",
  "managerToken",
  "accessToken",
] as const;

export function readManagerIdentity(storage: StorageLike | null): ManagerIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(MANAGER_SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    for (const k of REQUIRED_KEYS) {
      if (typeof v[k] !== "string" || !v[k]) {
        storage.removeItem(MANAGER_SESSION_IDENTITY_KEY);
        return null;
      }
    }
    return v as unknown as ManagerIdentity;
  } catch {
    try {
      storage.removeItem(MANAGER_SESSION_IDENTITY_KEY);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeManagerIdentity(
  storage: StorageLike | null,
  identity: ManagerIdentity,
): ManagerIdentity | null {
  if (!storage) return null;
  try {
    storage.setItem(MANAGER_SESSION_IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  } catch {
    return null;
  }
}

export function removeManagerIdentity(storage: StorageLike | null) {
  try {
    storage?.removeItem(MANAGER_SESSION_IDENTITY_KEY);
  } catch {
    return;
  }
}

export function browserManagerStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
