import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const manifest = () =>
  readFileSync(new URL("../src/lib/manifest.server.ts", import.meta.url), "utf8");

it("exports atomic upsertManifestItem with requireSuperAdmin", () => {
  const source = manifest();
  expect(source).toContain("upsertManifestItem");
  expect(source).toContain("requireSuperAdmin");
  expect(source).toContain('rpc("mutate_catalog"');
});

it("exports toggleManifestItem for active/inactive", () => {
  const source = manifest();
  expect(source).toContain("toggleManifestItem");
  expect(source).toContain("active: data.active");
});

it("exports deleteManifestItem through catalog RPC", () => {
  const source = manifest();
  expect(source).toContain("deleteManifestItem");
  expect(source).toContain('p_action: "delete"');
});

it("exports reorderManifestItem through catalog RPC", () => {
  const source = manifest();
  expect(source).toContain("reorderManifestItem");
  expect(source).toContain('p_action: "reorder"');
});

it("updates metadata without re-upload and distinguishes verification failures", () => {
  const source = manifest();
  expect(source).toContain("updateManifestMetadata");
  expect(source).toContain("VERIFY_FAILED");
  expect(source).toContain("r2_url: item.r2_url");
  expect(source).toContain("content_hash: item.content_hash");
  expect(source).toContain("byte_size: item.byte_size");
  expect(source).toContain("manifestItem");
});

it("keeps query failures unavailable and missing catalog rows not found", () => {
  const source = manifest();
  expect(source).toContain("if (restaurantError) return undefined");
  expect(source).toContain("if (!restaurant) return null");
});

it("exports listManifestItems for admin view", () => {
  const source = manifest();
  expect(source).toContain("listManifestItems");
  expect(source).toContain("catalog_version");
});

it("does not export separate catalog version bump", () => {
  const source = manifest();
  expect(source).not.toContain("bumpCatalogVersion");
});
