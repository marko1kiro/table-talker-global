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
// Clear Up), created via crew_shift_claim. Deliberately a distinct type
// and storage key from CrewSessionIdentity above, because the two stations are
// authorized differently: SS keeps the "Option B" shape (crewSessionId/Token
// empty -- its tenant token alone authorizes the soundboard), while these 3
// roles act on the role_session_token minted for them. accessToken is the
// device's Supabase Auth access token (Poin 3: a real crew account session,
// previously a per-device carrier), persisted here so
// table-occupancy.server.ts's authenticated-only RPCs can reuse it without a
// fresh sign-in call on every page load.
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
  // Only the WORK identities (tenant/role/session tokens) live in sessionStorage:
  // short-lived, gone on tab close. The Supabase Auth session itself -- refresh
  // token included -- is deliberately NOT here: browser-auth.ts lets supabase-js
  // persist it to localStorage so a crew shift survives reloads (Poin 3 §3.3).
  // That is XSS-readable and outlives the tab, the accepted cost of "one login =
  // one device"; the crew-side escape is CrewLoginFlow's "Keluar akun".
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

// Poin 3 Task 9 HARD CUTOVER: the legacy "kode + PIN" flow persisted a
// CrewSessionIdentity/RoleSessionIdentity in sessionStorage with no
// auth_uid lineage, and it can no longer be revalidated (claim_role_session is
// dropped and every pre-cutover role_session_token is revoked by
// 20260913130000). Trusting such a row on an upgraded device would resurrect
// the SS soundboard / a role page without any fresh account claim. So on the
// FIRST load after deploy we clear both legacy identities, forcing every crew
// through CrewLoginFlow. The sentinel lives in localStorage (not the
// just-cleared sessionStorage) so it survives the wipe and runs at most once
// per device -> it can never loop or fight a legitimately-issued Poin 3
// identity. Storage failures degrade to a no-op (the fresh browser-auth guard
// in CrewLoginFlow is the real authority), never a throw.
export const POIN3_CUTOVER_KEY = "table-talker.poin3-cutover";

// Pure core, injected storages so the "not trusted / runs once / no loop"
// contract is unit-testable without a DOM. Returns true iff it cleared this run.
export function clearLegacyCrewIdentities(
  session: StorageLike | null,
  local: StorageLike | null,
): boolean {
  if (!local) return false;
  try {
    if (local.getItem(POIN3_CUTOVER_KEY)) return false;
    local.setItem(POIN3_CUTOVER_KEY, "1");
  } catch {
    return false;
  }
  removeCrewSessionIdentity(session);
  removeRoleSessionIdentity(session);
  return true;
}

export function runPoin3Cutover(): boolean {
  if (typeof window === "undefined") return false;
  let local: StorageLike | null = null;
  try {
    local = window.localStorage;
  } catch {
    local = null;
  }
  return clearLegacyCrewIdentities(browserSessionStorage(), local);
}
