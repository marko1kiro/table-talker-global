import { normalizeCrewName } from "./remote-audio-domain";
import { CREW_ROLES, type CrewRole } from "./role-session-domain";

export const CREW_SESSION_IDENTITY_KEY = "table-talker.crew-identity";
export const ROLE_SESSION_IDENTITY_KEY = "table-talker.role-identity";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CrewSessionIdentity = {
  displayName: string;
  normalizedName: string;
  restaurantId: string;
  restaurantDisplayName: string;
  tenantToken: string;
  crewSessionId: string;
  crewSessionToken: string;
};

// Moved here from the now-deleted CrewIdentityDialog.tsx (Task 8) so
// src/routes/index.tsx can keep importing it from this module alongside
// the storage helpers below.
export type CrewIdentity = CrewSessionIdentity & { audioReady: boolean };

// Task 8: the audit-trail identity for the 3 non-SS roles (Kasir/Satgas/
// Clear Up), created via claim_role_session. Deliberately a distinct type
// and storage key from CrewSessionIdentity above -- see Option B note on
// claim_crew_session in role-session.server.ts. accessToken is the
// device's anonymous-auth Supabase access token, persisted here so
// table-occupancy.server.ts's authenticated-only RPCs (Task 9+) can reuse
// it without a fresh signInAnonymously() call on every page load.
export type RoleSessionIdentity = {
  restaurantId: string;
  restaurantDisplayName: string;
  restaurantCode: string;
  tenantToken: string;
  role: CrewRole;
  displayName: string;
  checkedInAt: string;
  roleSessionId: string;
  roleSessionToken: string;
  accessToken: string;
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
      restaurantDisplayName?: unknown;
      tenantToken?: unknown;
      crewSessionId?: unknown;
      crewSessionToken?: unknown;
    };
    if (
      typeof value.displayName !== "string" ||
      typeof value.normalizedName !== "string" ||
      typeof value.restaurantId !== "string" ||
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

export function readRoleSessionIdentity(storage: StorageLike | null): RoleSessionIdentity | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ROLE_SESSION_IDENTITY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as {
      restaurantId?: unknown;
      restaurantDisplayName?: unknown;
      restaurantCode?: unknown;
      tenantToken?: unknown;
      role?: unknown;
      displayName?: unknown;
      checkedInAt?: unknown;
      roleSessionId?: unknown;
      roleSessionToken?: unknown;
      accessToken?: unknown;
    };
    if (
      typeof value.restaurantId !== "string" ||
      typeof value.restaurantDisplayName !== "string" ||
      typeof value.tenantToken !== "string" ||
      !value.tenantToken ||
      typeof value.role !== "string" ||
      !(CREW_ROLES as readonly string[]).includes(value.role) ||
      typeof value.displayName !== "string" ||
      !value.displayName ||
      typeof value.checkedInAt !== "string" ||
      !value.checkedInAt ||
      typeof value.roleSessionId !== "string" ||
      typeof value.roleSessionToken !== "string" ||
      typeof value.accessToken !== "string"
    ) {
      storage.removeItem(ROLE_SESSION_IDENTITY_KEY);
      return null;
    }
    return {
      restaurantId: value.restaurantId as string,
      restaurantDisplayName: value.restaurantDisplayName as string,
      restaurantCode: typeof value.restaurantCode === "string" ? value.restaurantCode : "",
      tenantToken: value.tenantToken as string,
      role: value.role as CrewRole,
      displayName: value.displayName,
      checkedInAt: value.checkedInAt,
      roleSessionId: value.roleSessionId,
      roleSessionToken: value.roleSessionToken,
      accessToken: value.accessToken,
    };
  } catch {
    try {
      storage.removeItem(ROLE_SESSION_IDENTITY_KEY);
    } catch {
      return null;
    }
    return null;
  }
}

export function writeRoleSessionIdentity(
  storage: StorageLike | null,
  identity: RoleSessionIdentity,
): RoleSessionIdentity | null {
  if (!storage) return null;
  try {
    storage.setItem(ROLE_SESSION_IDENTITY_KEY, JSON.stringify(identity));
    return identity;
  } catch {
    return null;
  }
}

export function removeRoleSessionIdentity(storage: StorageLike | null) {
  try {
    storage?.removeItem(ROLE_SESSION_IDENTITY_KEY);
  } catch {
    return;
  }
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
