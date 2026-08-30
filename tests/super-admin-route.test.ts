import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("never shows remote unavailable copy in the crew UI", () => {
  const dialog = readFileSync(
    new URL("../src/components/CrewIdentityDialog.tsx", import.meta.url),
    "utf8",
  );
  const route = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

  expect(dialog).not.toContain("Remote control tidak tersedia. Soundboard tetap bisa dipakai.");
  expect(route).not.toContain("Remote control tidak tersedia. Soundboard tetap bisa dipakai.");
  expect(route).not.toContain("remoteCrew.offline");
});

it("guards owner shell with super-admin session bit and noindex", () => {
  const source = readFileSync(
    new URL("../src/routes/super-admin/route.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("auth?.superAdmin");
  expect(source).toContain('{ name: "robots", content: "noindex" }');
  expect(source).toContain("loginSuperAdmin");
  expect(source).toContain("<Outlet");
});

it("logs out from shared owner navigation without clearing non-owner query cache", () => {
  const source = readFileSync(
    new URL("../src/routes/super-admin/route.tsx", import.meta.url),
    "utf8",
  );

  expect(source).toContain('import { getAuthStatus, loginSuperAdmin, logout } from "@/lib/auth"');
  expect(source).toContain("useQueryClient");
  expect(source).toContain('type="button"');
  expect(source).toContain("Keluar");
  expect(source).toContain("disabled={loggingOut}");
  expect(source).toContain('role="alert"');
  expect(source).toContain("isOwnerQueryKey(query.queryKey)");
  expect(source).toContain("setMenuOpen(false)");
  expect(source).toContain("router.invalidate()");
  const success = source.slice(
    source.indexOf("const result = await logout()"),
    source.indexOf("} catch"),
  );
  expect(success).not.toContain("if (!mounted.current) return");
  expect(success.indexOf("isOwnerQueryKey(query.queryKey)")).toBeLessThan(
    success.indexOf("await router.invalidate()"),
  );
});

it("keeps every owner route query namespace logout-purgeable", () => {
  for (const path of [
    "../src/routes/super-admin/audio.tsx",
    "../src/routes/super-admin/error-log.tsx",
    "../src/routes/super-admin/history.tsx",
    "../src/routes/super-admin/index.tsx",
    "../src/routes/super-admin/restaurants/index.tsx",
    "../src/routes/super-admin/restaurants/$id.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).not.toContain('["manifest"');
    expect(source).not.toContain('["operational-errors"');
  }
  expect(
    readFileSync(new URL("../src/routes/super-admin/audio.tsx", import.meta.url), "utf8"),
  ).toContain('["owner-manifest", restaurantId]');
  expect(
    readFileSync(new URL("../src/routes/super-admin/error-log.tsx", import.meta.url), "utf8"),
  ).toContain('"owner-operational-errors"');
});
