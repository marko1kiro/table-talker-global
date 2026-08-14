import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import {
  commandStatus,
  canSelectRemoteAudio,
  reconcileRemoteSelection,
} from "../src/lib/super-admin-state";
import { createInvalidationDebouncer, realtimeIsReady } from "../src/lib/super-admin-realtime";

it("keeps Play disabled until the invalidation channel subscribes", () => {
  expect(realtimeIsReady("SUBSCRIBING")).toBe(false);
  expect(realtimeIsReady("SUBSCRIBED")).toBe(true);
  expect(realtimeIsReady("CHANNEL_ERROR")).toBe(false);
});

it("invalidates immediately then once at the end of a burst", () => {
  vi.useFakeTimers();
  const invalidate = vi.fn();
  const debouncer = createInvalidationDebouncer(invalidate);

  debouncer();
  vi.advanceTimersByTime(500);
  debouncer();
  vi.advanceTimersByTime(499);
  debouncer();
  expect(invalidate).toHaveBeenCalledOnce();

  vi.advanceTimersByTime(1_000);
  expect(invalidate).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});

it("cancels a queued invalidation", () => {
  vi.useFakeTimers();
  const invalidate = vi.fn();
  const debouncer = createInvalidationDebouncer(invalidate);

  debouncer();
  debouncer();
  debouncer.cancel();
  vi.advanceTimersByTime(1_000);

  expect(invalidate).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it("shows remote unavailable copy only after a failed registration", () => {
  const dialog = readFileSync(
    new URL("../src/components/CrewIdentityDialog.tsx", import.meta.url),
    "utf8",
  );
  const route = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

  expect(dialog).not.toContain("Remote control tidak tersedia. Soundboard tetap bisa dipakai.");
  expect(route).toContain("remoteCrew.offline && crewIdentity");
});

it("enables a soundboard selection only for a valid online idle target", () => {
  expect(canSelectRemoteAudio({ offline: false, targetSessionId: "crew", pending: false })).toBe(
    true,
  );
  expect(canSelectRemoteAudio({ offline: true, targetSessionId: "crew", pending: false })).toBe(
    false,
  );
  expect(canSelectRemoteAudio({ offline: false, targetSessionId: "", pending: false })).toBe(false);
  expect(canSelectRemoteAudio({ offline: false, targetSessionId: "crew", pending: true })).toBe(
    false,
  );
});

it("clears a target removed from an updated eligible target snapshot", () => {
  expect(
    reconcileRemoteSelection("crew-1", [{ id: "crew-1", eligible: true, audioReady: true }]),
  ).toEqual("crew-1");
  expect(
    reconcileRemoteSelection("crew-1", [{ id: "crew-1", eligible: false, audioReady: true }]),
  ).toBe("");
  expect(reconcileRemoteSelection("crew-1", [])).toBe("");
});

it("shows sent commands as expired at their effective expiry time", () => {
  expect(
    commandStatus(
      { status: "sent", expires_at: "2026-08-12T10:00:00.000Z" },
      Date.parse("2026-08-12T10:00:00.000Z"),
    ),
  ).toBe("expired");
  expect(
    commandStatus(
      { status: "played", expires_at: "2026-08-12T09:00:00.000Z" },
      Date.parse("2026-08-12T10:00:00.000Z"),
    ),
  ).toBe("played");
});

it("guards the route with the super-admin session bit and noindex", () => {
  const source = readFileSync(new URL("../src/routes/super-admin.tsx", import.meta.url), "utf8");
  expect(source).toContain("auth.superAdmin");
  expect(source).toContain('{ name: "robots", content: "noindex" }');
  expect(source).toContain("loginSuperAdmin");
  expect(source).toContain("setInterval");
  expect(source).toContain("onError");
  expect(source).toContain('role="alert"');
  expect(source).toContain("mutation.reset()");
});
