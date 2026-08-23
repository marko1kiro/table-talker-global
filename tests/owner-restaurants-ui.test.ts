import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("links restaurant list to dedicated details and reuses credential dialog", () => {
  const list = read("../src/routes/super-admin/restaurants/index.tsx");
  const detail = read("../src/routes/super-admin/restaurants/$id.tsx");
  expect(list).toContain('to="/super-admin/restaurants/$id"');
  expect(detail).toContain("RestaurantCredentialDialog");
  expect(detail).toContain("deactivateRestaurant");
  expect(detail).toContain("displayNameConfirmation");
});

it("audio route hashes MP3 browser uploads and uses owner catalog actions", () => {
  const audio = read("../src/routes/super-admin/audio.tsx");
  expect(audio).toContain("crypto.subtle.digest");
  expect(audio).toContain("audio/mpeg");
  expect(audio).toContain("requestR2Upload");
  expect(audio).toContain("upsertManifestItem");
  expect(audio).toContain("toggleManifestItem");
  expect(audio).toContain("deleteManifestItem");
  expect(audio).toContain("reorderManifestItem");
  expect(audio).not.toContain('type="url"');
});
