import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const manifest = () =>
  readFileSync(new URL("../src/lib/manifest.server.ts", import.meta.url), "utf8");

it("exports upsertManifestItem with requireSuperAdmin", () => {
  const source = manifest();
  expect(source).toContain("upsertManifestItem");
  expect(source).toContain("requireSuperAdmin");
  expect(source).toContain('from("audio_manifests")');
});

it("exports toggleManifestItem for active/inactive", () => {
  const source = manifest();
  expect(source).toContain("toggleManifestItem");
  expect(source).toContain("active: data.active");
});

it("exports deleteManifestItem with hard delete", () => {
  const source = manifest();
  expect(source).toContain("deleteManifestItem");
  expect(source).toContain('.delete()');
});

it("exports listManifestItems for admin view", () => {
  const source = manifest();
  expect(source).toContain("listManifestItems");
  expect(source).toContain("catalog_version");
});

it("exports bumpCatalogVersion to increment version", () => {
  const source = manifest();
  expect(source).toContain("bumpCatalogVersion");
  expect(source).toContain("catalog_version");
});
