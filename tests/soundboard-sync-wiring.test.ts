import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const route = () =>
  readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

it("imports SyncDialog component", () => {
  expect(route()).toContain('import { SyncDialog } from "@/components/SyncDialog"');
});

it("shows SyncDialog when restaurantId present and not synced", () => {
  const source = route();
  expect(source).toContain("crewIdentity?.restaurantId && !audioSynced");
  expect(source).toContain("<SyncDialog");
});

it("resets audioSynced when new identity is created", () => {
  const source = route();
  expect(source).toContain("setAudioSynced(false)");
});

it("stores verified audio IDs then sets audioSynced on onSynced callback", () => {
  const source = route();
  expect(source).toContain("setAvailableAudioIds(new Set(audioIds as AudioId[]))");
  expect(source).toContain("setAudioSynced(true)");
});
