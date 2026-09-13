// Poin 3 Task 9: homepage hard-cutover evidence.
// (1) behavioural: clearLegacyCrewIdentities drops a stale pre-Poin-3 crew/role
//     identity exactly once per device and NEVER re-clears a session that the NEW
//     account flow legitimately wrote (forces re-register, does not loop);
// (2) source: the homepage mounts CrewLoginFlow (RoleLoginFlow import gone) with
//     a separate MANAGER entry, and crew-only legacy server paths are removed so
//     main can never reach a dropped RPC / deleted component.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREW_SESSION_IDENTITY_KEY,
  POIN3_CUTOVER_KEY,
  ROLE_SESSION_IDENTITY_KEY,
  clearLegacyCrewIdentities,
} from "../src/lib/crew-session-identity";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type FakeStore = StorageLike & { data: Record<string, string> };

function fakeStore(initial: Record<string, string> = {}): FakeStore {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
    removeItem: (k: string) => {
      delete data[k];
    },
  };
}

const LEGACY_CREW = JSON.stringify({
  displayName: "Budi",
  normalizedName: "budi",
  restaurantId: "33916a05-7e95-42fa-bc3c-050bed2402c5",
  restaurantDisplayName: "RMuji",
  tenantToken: "legacy-tenant",
  crewSessionId: "legacy-session",
  crewSessionToken: "legacy-token",
});

describe("clearLegacyCrewIdentities (Poin 3 cutover guard)", () => {
  it("drops a stale legacy crew + role identity and stamps the once-flag", () => {
    const session = fakeStore({
      [CREW_SESSION_IDENTITY_KEY]: LEGACY_CREW,
      [ROLE_SESSION_IDENTITY_KEY]: JSON.stringify({ role: "kasir", tenantToken: "t" }),
    });
    const local = fakeStore();
    expect(clearLegacyCrewIdentities(session, local)).toBe(true);
    expect(session.data[CREW_SESSION_IDENTITY_KEY]).toBeUndefined();
    expect(session.data[ROLE_SESSION_IDENTITY_KEY]).toBeUndefined();
    expect(local.data[POIN3_CUTOVER_KEY]).toBe("1");
  });

  it("runs at most once: a re-written (legit Poin 3) identity is NOT cleared again -> no loop", () => {
    const session = fakeStore();
    const local = fakeStore();
    clearLegacyCrewIdentities(session, local); // first load
    // New flow writes a fresh identity, then a reload re-runs the guard.
    session.data[CREW_SESSION_IDENTITY_KEY] = LEGACY_CREW;
    expect(clearLegacyCrewIdentities(session, local)).toBe(false);
    expect(session.data[CREW_SESSION_IDENTITY_KEY]).toBe(LEGACY_CREW); // preserved
  });

  it("never throws when storage is unavailable (SSR / private mode)", () => {
    expect(clearLegacyCrewIdentities(null, null)).toBe(false);
    const throwingLocal: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const session = fakeStore({ [CREW_SESSION_IDENTITY_KEY]: LEGACY_CREW });
    expect(clearLegacyCrewIdentities(session, throwingLocal)).toBe(false);
  });
});

describe("index.tsx homepage wiring (post-cutover)", () => {
  const index = () => readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

  it("mounts CrewLoginFlow, not RoleLoginFlow (deleted component)", () => {
    const text = index();
    expect(text).not.toMatch(/RoleLoginFlow/);
    expect(text).toContain('import { CrewLoginFlow } from "@/components/CrewLoginFlow"');
    expect(text).toContain("<CrewLoginFlow");
  });

  it("keeps a separate MANAGER entry to /manager/login alongside the crew flow", () => {
    const text = index();
    expect(text).toContain("Login Manager");
    expect(text).toContain('to="/manager/login"');
  });

  it("calls the one-time cutover guard before hydrating any identity", () => {
    const text = index();
    expect(text).toContain("runPoin3Cutover()");
    const guard = text.indexOf("runPoin3Cutover()");
    const hydrate = text.indexOf("readCrewSessionIdentity(browserSessionStorage())");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(hydrate); // clear BEFORE trusting a persisted row
  });

  it("the legacy RoleLoginFlow component is gone from disk", () => {
    expect(existsSync(new URL("../src/components/RoleLoginFlow.tsx", import.meta.url))).toBe(false);
  });
});

describe("crew-only legacy server paths removed (main never references dropped RPCs)", () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

  it("role-session.server.ts no longer wraps the dropped claim_role_session RPC", () => {
    const text = read("../src/lib/role-session.server.ts");
    expect(text).not.toContain("claim_role_session");
    expect(text).not.toContain("claimRoleSession");
    // the shared helpers crews/manager reads still rely on remain exported
    expect(text).toContain("export function getAnonAuthedSupabaseClient");
    expect(text).toContain("export async function verifyRoleSessionToken");
  });

  it("restaurants.server.ts no longer wraps the crew-only code+PIN path", () => {
    const text = read("../src/lib/restaurants.server.ts");
    expect(text).not.toContain("loginToRestaurant");
    expect(text).not.toContain("verifyRestaurantPin");
    expect(text).toContain("getRestaurantManifest"); // SS soundboard reuses it
  });
});
