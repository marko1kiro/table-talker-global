// Task 9: shared role-UI infrastructure. Thin, dependency-injected
// localStorage wrapper for each role's grid/list layout preference.
//
// Deliberately uses window.localStorage (device-persisted, survives
// browser restarts) rather than the tab-scoped storage adapter used by
// crew-session-identity.ts for role/device identity -- these are two
// distinct storage mechanisms for two distinct concerns in this codebase.
//
// The pure readLayoutPreference/writeLayoutPreference functions take an
// injectable storage-like object (mirroring the StorageLike pattern in
// crew-session-identity.ts) so they can be unit-tested without a real
// browser environment. useLayoutPreference is the thin React hook that
// wires those pure functions to window.localStorage for actual pages.
import { useEffect, useState } from "react";
import type { CrewRole } from "./role-session-domain";

export type LayoutPreference = "grid" | "list";

const LAYOUT_PREFERENCES: readonly LayoutPreference[] = ["grid", "list"];

// Task 12 correction note (2026-09-01): the Task 12 plan text calls for
// "list is the natural default" for Clear Up specifically, unlike
// Kasir/Satgas which both rely on this module's original single global
// default of "grid". Rather than hardcode that choice inside the new
// Clear Up route (which would silently diverge from how every other role
// resolves its default, and wouldn't survive a first write), the default
// is made role-aware here, in the one place that already owns "what does
// this role see before it has ever chosen" for every role. Kasir/Satgas
// behavior is unchanged (still "grid") -- see
// tests/use-layout-preference.test.ts for coverage proving that.
const ROLE_DEFAULT_LAYOUT_PREFERENCE: Record<CrewRole, LayoutPreference> = {
  ss: "grid",
  kasir: "grid",
  satgas: "grid",
  clear_up: "list",
};

type StorageLike = {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
};

export function layoutPreferenceKey(role: CrewRole): string {
  return `table-talker.layout.${role}`;
}

export function readLayoutPreference(
  role: CrewRole,
  storage: StorageLike | null,
): LayoutPreference {
  const roleDefault = ROLE_DEFAULT_LAYOUT_PREFERENCE[role];
  if (!storage) return roleDefault;
  try {
    const raw = storage.getItem?.(layoutPreferenceKey(role)) ?? null;
    if (raw && (LAYOUT_PREFERENCES as readonly string[]).includes(raw)) {
      return raw as LayoutPreference;
    }
    return roleDefault;
  } catch {
    return roleDefault;
  }
}

export function writeLayoutPreference(
  role: CrewRole,
  value: LayoutPreference,
  storage: StorageLike | null,
): void {
  if (!storage) return;
  try {
    storage.setItem?.(layoutPreferenceKey(role), value);
  } catch {
    // Storage unavailable/blocked (e.g. private browsing) -- silently drop,
    // matching this codebase's established fail-open storage pattern.
  }
}

function browserLocalStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useLayoutPreference(role: CrewRole) {
  const [preference, setPreference] = useState<LayoutPreference>(() =>
    readLayoutPreference(role, browserLocalStorage()),
  );

  useEffect(() => {
    setPreference(readLayoutPreference(role, browserLocalStorage()));
  }, [role]);

  const setLayoutPreference = (value: LayoutPreference) => {
    setPreference(value);
    writeLayoutPreference(role, value, browserLocalStorage());
  };

  return { layoutPreference: preference, setLayoutPreference };
}
