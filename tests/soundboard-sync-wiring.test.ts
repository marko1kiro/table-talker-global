import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const route = () => readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

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

it("stores verified audio IDs, enables playback, then warms cached object URLs", () => {
  const source = route();
  const storeIds = source.indexOf("setAvailableAudioIds(new Set(audioIds as AudioId[]))");
  const enablePlayback = source.indexOf("setAudioSynced(true)", storeIds);
  const preload = source.indexOf("getAudioUrlPool().preload", enablePlayback);

  expect(storeIds).toBeGreaterThan(-1);
  expect(enablePlayback).toBeGreaterThan(storeIds);
  expect(preload).toBeGreaterThan(enablePlayback);
});

it("passes snapshot fallback + offline/fresh callbacks to SyncDialog", () => {
  const source = route();
  expect(source).toContain("fallbackSnapshot");
  expect(source).toContain("onOfflineReady");
  expect(source).toContain("onManifestFresh");
});

it("persists and clears manifest snapshots around the sync lifecycle", () => {
  const source = route();
  expect(source).toContain("saveAudioSnapshot");
  expect(source).toContain("clearAudioSnapshot");
});

it("shows background sync progress and retry affordance in the title row", () => {
  const source = route();
  expect(source).toContain("Sync audio");
  expect(source).toContain("ketuk untuk ulangi");
});

it("toasts only on version-raising background sync", () => {
  expect(route()).toContain("Audio diperbarui");
});

it("exposes audio age + reconnect action in Profile", () => {
  const source = route();
  expect(source).toContain("formatAudioAge");
  expect(source).toContain("Coba sambung lagi");
});

it("re-probes the manifest when the browser comes back online", () => {
  expect(route()).toContain('addEventListener("online"');
});
