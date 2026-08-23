import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const file = (path: string) => readFileSync(new URL(path, root), "utf8");

it("adds one locked catalog mutation RPC that copy-forwards current rows", () => {
  const path = new URL("supabase/migrations/20260823103000_catalog_version_rpc.sql", root);
  expect(existsSync(path)).toBe(true);

  const migration = file("supabase/migrations/20260823103000_catalog_version_rpc.sql");
  expect(migration).toMatch(/create(?: or replace)? function public\.mutate_catalog\(/i);
  expect(migration).toMatch(/select catalog_version[\s\S]*?for update/i);
  expect(migration).toMatch(/catalog_version = v_next_version/i);
  expect(migration).toMatch(/insert into public\.audio_manifests[\s\S]*?select[\s\S]*?catalog_version = v_current_version/i);
  expect(migration).toMatch(/on conflict \(restaurant_id, audio_id, catalog_version\) do update/i);
  expect(migration).toMatch(/delete from public\.audio_manifests[\s\S]*?catalog_version = v_next_version/i);
});

it("uses guarded atomic catalog mutation and reads current version only", () => {
  const manifest = file("src/lib/manifest.server.ts");
  const restaurants = file("src/lib/restaurants.server.ts");
  const admin = file("src/routes/super-admin.tsx");

  expect(manifest).toContain('rpc("mutate_catalog"');
  expect(manifest).not.toContain("bumpCatalogVersion");
  expect(manifest).toMatch(/\.eq\("catalog_version", restaurant\.catalog_version\)/);
  expect(restaurants).toContain("verifyActiveTenantSession(client, data.tenantToken)");
  expect(restaurants).toMatch(/\.eq\("catalog_version", restaurant\.catalog_version\)/);
  expect(restaurants).toContain("version: restaurant.catalog_version");
  expect(admin).not.toContain("bumpCatalogVersion");
  expect(admin).toMatch(/toggleManifestItem[\s\S]*?if \(!result \|\| !\("ok" in result\) \|\| !result\.ok\)/);
});
