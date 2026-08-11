import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  commandStatus,
  canPlayRemoteAudio,
  reconcileRemoteSelection,
} from "../src/lib/super-admin-state";

it("enables Play only for a valid online idle selection", () => {
  expect(
    canPlayRemoteAudio({
      offline: false,
      targetSessionId: "crew",
      audioId: "table:1",
      pending: false,
    }),
  ).toBe(true);
  expect(
    canPlayRemoteAudio({
      offline: true,
      targetSessionId: "crew",
      audioId: "table:1",
      pending: false,
    }),
  ).toBe(false);
  expect(
    canPlayRemoteAudio({ offline: false, targetSessionId: "", audioId: "table:1", pending: false }),
  ).toBe(false);
  expect(
    canPlayRemoteAudio({ offline: false, targetSessionId: "crew", audioId: "", pending: false }),
  ).toBe(false);
  expect(
    canPlayRemoteAudio({
      offline: false,
      targetSessionId: "crew",
      audioId: "table:1",
      pending: true,
    }),
  ).toBe(false);
});

it("clears selections removed from an updated eligible target or catalog snapshot", () => {
  expect(
    reconcileRemoteSelection(
      "crew-1",
      "table:1",
      [{ id: "crew-1", eligible: true, audioReady: true }],
      ["table:1"],
    ),
  ).toEqual({ targetSessionId: "crew-1", audioId: "table:1" });
  expect(
    reconcileRemoteSelection(
      "crew-1",
      "table:1",
      [{ id: "crew-1", eligible: false, audioReady: true }],
      ["table:1"],
    ),
  ).toEqual({ targetSessionId: "", audioId: "table:1" });
  expect(reconcileRemoteSelection("crew-1", "table:1", [], [])).toEqual({
    targetSessionId: "",
    audioId: "",
  });
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
