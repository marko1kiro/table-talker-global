// Pure, framework-free helpers for the crew login flow. Kept
// separate from role-session.server.ts (which owns the server-only
// role-session helpers) so CrewLoginFlow.tsx's role picker can import plain,
// client-safe logic without pulling in a *.server.ts module (which bundles
// node:crypto and is tree-shaken into a server-only chunk unusable from client
// code).
//
// CREW_ROLES/CrewRole are the canonical source of truth here;
// role-session.server.ts re-exports them for backward compatibility with
// existing Task 6 imports rather than the other way around.
export const CREW_ROLES = ["ss", "kasir", "satgas", "clear_up"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

// Display order for the 4-button role picker, per the spec's
// "[SS] [Kasir] [Satgas] [Clear Up]" sequence.
export const CREW_ROLE_ORDER: readonly CrewRole[] = CREW_ROLES;

export const CREW_ROLE_LABELS: Record<CrewRole, string> = {
  ss: "SS",
  kasir: "Kasir",
  satgas: "Satgas",
  clear_up: "Clear Up",
};
