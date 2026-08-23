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
  expect(detail).toContain("AlertDialog");
  expect(detail).toContain("disabled={displayNameConfirmation !== restaurant.displayName}");
  expect(detail).toContain("sync_history");
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
  expect(audio).toContain("AlertDialog");
  expect(audio).toContain('queryKey: ["owner-dashboard"]');
  expect(audio).toContain("updateManifestMetadata");
  expect(audio).toContain("pendingItem");
  expect(audio).toContain("mutationError");
  expect(audio).not.toContain(".then(refresh)");
  expect(audio).toMatch(
    /const mutate[\s\S]*?catch \(cause\)[\s\S]*?finally[\s\S]*?setPendingItem\(""\)/,
  );
  expect(audio).toMatch(
    /AlertDialogTrigger asChild>[\s\S]*?disabled=\{pendingItem === item\.audio_id\}/,
  );
  expect(audio).toMatch(/AlertDialogAction[\s\S]*?disabled=\{pendingItem === item\.audio_id\}/);
  expect(audio).toContain('aria-label="Audio ID"');
  expect(audio).toContain('aria-label="Label audio"');
  expect(audio).toContain('aria-label="Kategori audio"');
  expect(audio).toContain("AlertDialogDescription");
});
