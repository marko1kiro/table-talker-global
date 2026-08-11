import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { commandStatus, canPlayRemoteAudio } from "../src/lib/super-admin-state";

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
});
