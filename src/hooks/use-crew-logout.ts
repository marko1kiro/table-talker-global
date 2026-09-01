import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  browserSessionStorage,
  removeCrewSessionIdentity,
  removeRoleSessionIdentity,
} from "@/lib/crew-session-identity";
import { clearQueuedEvents } from "@/lib/event-queue";

// H-06: generic, functional sign-out for pages that render Header/CrewHeader
// but own no crew/role identity state themselves -- the 6 public info pages
// (about, contact, faq, help, privacy-policy, terms-of-use). Those pages
// previously rendered <Header readyCount={0} totalCount={0} /> without an
// onLogout handler at all, which (a) violated HeaderProps' required
// `onLogout` and (b) left the logout button calling `undefined` at runtime.
//
// An info page has no way of knowing whether the visitor is actually
// mid-session as Station SS (CrewSessionIdentity) or as Kasir/Satgas/Clear
// Up (RoleSessionIdentity), so this clears both possible identity keys plus
// the shared IndexedDB telemetry queue -- whichever one is actually present
// is removed, the other is already absent and the removal is a no-op -- then
// returns to the login flow at "/".
//
// Deliberately does NOT reuse src/routes/index.tsx's own `logout`: that one
// also tears down in-flight audio playback refs/state (stopping the
// soundboard controller, clearing the URL pool, resetting playback
// generation, etc.) that only the SS station route owns and that these
// info pages never create in the first place.
export function useCrewLogout(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const storage = browserSessionStorage();
    removeCrewSessionIdentity(storage);
    removeRoleSessionIdentity(storage);
    void clearQueuedEvents();
    void navigate({ to: "/" });
  }, [navigate]);
}
