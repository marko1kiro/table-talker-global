import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function handlerRequiresSuperAdmin(file: string, handler: string) {
  const match = source(file).match(
    new RegExp(`export const ${handler}[\\s\\S]*?(?=\\nexport const|$)`),
  );
  expect(match, `${handler} handler not found`).not.toBeNull();
  expect(match?.[0]).toContain("await requireSuperAdmin();");
}

it("requires owner auth for restaurant and manifest administration", () => {
  handlerRequiresSuperAdmin("../src/lib/restaurants.server.ts", "listRestaurants");
  handlerRequiresSuperAdmin("../src/lib/manifest.server.ts", "listManifestItems");
  handlerRequiresSuperAdmin("../src/lib/manifest.server.ts", "upsertManifestItem");
  handlerRequiresSuperAdmin("../src/lib/manifest.server.ts", "toggleManifestItem");
  handlerRequiresSuperAdmin("../src/lib/manifest.server.ts", "deleteManifestItem");
});

it("requires owner auth for operational error administration", () => {
  handlerRequiresSuperAdmin("../src/lib/operational-errors.server.ts", "listOperationalErrors");
  handlerRequiresSuperAdmin("../src/lib/operational-errors.server.ts", "resolveOperationalError");
});

it("requires owner auth to clean playback history without restricting ingestion", () => {
  handlerRequiresSuperAdmin("../src/lib/playback-events.server.ts", "cleanupOldPlaybackEvents");
  expect(source("../src/lib/playback-events.server.ts")).toContain("export const ingestPlaybackEvents");
  expect(source("../src/lib/operational-errors.server.ts")).toContain("export const reportOperationalError");
});

it("removes global authenticated manifest reads", () => {
  const migration = source("../supabase/migrations/20260823101000_lock_manifest_rls.sql");
  expect(migration).toMatch(/revoke select on public\.audio_manifests from authenticated/i);
  expect(migration).toMatch(/drop policy if exists "crew reads restaurant manifests" on public\.audio_manifests/i);
  expect(migration).not.toMatch(/grant select on public\.audio_manifests to authenticated/i);
  expect(migration).not.toMatch(/for select to authenticated[\s\S]*?using \(true\)/i);
});
