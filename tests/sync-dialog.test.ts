import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const component = () =>
  readFileSync(new URL("../src/components/SyncDialog.tsx", import.meta.url), "utf8");

it("imports getRestaurantManifest and syncManifest", () => {
  const source = component();
  expect(source).toContain('import { getRestaurantManifest }');
  expect(source).toContain('import {');
  expect(source).toContain("syncManifest");
});

it("shows fetching, syncing, done, and error states", () => {
  const source = component();
  expect(source).toContain('"fetching"');
  expect(source).toContain('"syncing"');
  expect(source).toContain('"done"');
  expect(source).toContain('"error"');
});

it("renders progress bar and Coba Lagi button", () => {
  const source = component();
  expect(source).toContain("animate-spin");
  expect(source).toContain("Coba Lagi");
  expect(source).toContain("progress");
});

it("passes verified manifest audio IDs to onSynced when sync completes", () => {
  const source = component();
  expect(source).toContain("onSynced(res.manifest.map(({ audioId }) => audioId))");
});

it("blocks UI with fixed overlay (no cancel button)", () => {
  const source = component();
  expect(source).toContain("fixed inset-0");
  expect(source).not.toContain("Batal");
});
