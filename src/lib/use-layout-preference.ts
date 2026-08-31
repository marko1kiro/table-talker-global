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
const DEFAULT_LAYOUT_PREFERENCE: LayoutPreference = "grid";

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
  if (!storage) return DEFAULT_LAYOUT_PREFERENCE;
  try {
    const raw = storage.getItem?.(layoutPreferenceKey(role)) ?? null;
    if (raw && (LAYOUT_PREFERENCES as readonly string[]).includes(raw)) {
      return raw as LayoutPreference;
    }
    return DEFAULT_LAYOUT_PREFERENCE;
  } catch {
    return DEFAULT_LAYOUT_PREFERENCE;
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
