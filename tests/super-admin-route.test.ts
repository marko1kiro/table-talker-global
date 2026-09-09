import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  isPublicSuperAdminPath,
  PUBLIC_SUPER_ADMIN_PATHS,
} from "../src/lib/super-admin-public-paths";

it("accept + recovery open without a session; admin paths stay gated (A4)", () => {
  expect(PUBLIC_SUPER_ADMIN_PATHS).toContain("/super-admin/accept");
  expect(PUBLIC_SUPER_ADMIN_PATHS).toContain("/super-admin/recovery");
  expect(isPublicSuperAdminPath("/super-admin/accept")).toBe(true);
  expect(isPublicSuperAdminPath("/super-admin/recovery")).toBe(true);
  expect(isPublicSuperAdminPath("/super-admin/accept/")).toBe(true);
  expect(isPublicSuperAdminPath("/super-admin/staff-accounts")).toBe(false);
  expect(isPublicSuperAdminPath("/super-admin/audit")).toBe(false);
  expect(isPublicSuperAdminPath("/super-admin/managers")).toBe(false);
});

it("the console shell bypasses the gate for public children only", () => {
  const source = readFileSync(
    new URL("../src/routes/super-admin/route.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain(
    'import { isPublicSuperAdminPath } from "@/lib/super-admin-public-paths"',
  );
  // The public bypass (bare <Outlet />) must be evaluated BEFORE the AuthGate.
  expect(source.indexOf("isPublicSuperAdminPath(pathname)")).toBeLessThan(
    source.indexOf("<AuthGate"),
  );
});

it("never shows remote unavailable copy in the crew UI", () => {
  const dialog = readFileSync(
    new URL("../src/components/RoleLoginFlow.tsx", import.meta.url),
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
  expect(source).toContain("DashboardHeaderRight");
  expect(source).toContain("onLogout={handleLogout}");
  expect(source).toContain('role="alert"');
  expect(source).toContain("isOwnerQueryKey(query.queryKey)");
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

it("renders the TailAdmin AppShell with a light brand-blue sidebar", () => {
  const source = readFileSync(
    new URL("../src/routes/super-admin/route.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("AppShell");
  expect(source).toContain("@/components/dashboard/AppShell");
  expect(source).not.toContain("bg-slate-950");
});

it("header uses the unified cluster (theme toggle + profile live inside it)", () => {
  const source = readFileSync(
    new URL("../src/routes/super-admin/route.tsx", import.meta.url),
    "utf8",
  );
  expect(source).toContain("DashboardHeaderRight");
  expect(source).toContain("@/components/dashboard/DashboardHeaderRight");
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
