import { existsSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("replaces remote audio route with protected owner shell routes", () => {
  expect(existsSync(new URL("../src/routes/super-admin.tsx", import.meta.url))).toBe(false);
  const shell = source("../src/routes/super-admin/route.tsx");
  expect(shell).toContain('createFileRoute("/super-admin")');
  expect(shell).toContain("getAuthStatus");
  expect(shell).toContain("loginSuperAdmin");
  expect(shell).not.toContain("requireSuperAdmin");
  expect(shell).toContain("<Outlet");
  for (const route of [
    "/super-admin",
    "/super-admin/restaurants",
    "/super-admin/audio",
    "/super-admin/history",
    "/super-admin/error-log",
    "/super-admin/broadcast",
  ]) {
    expect(shell).toContain(route);
  }
});

it("keeps dashboard server-only, protected, bounded, and independently degraded", () => {
  const server = source("../src/lib/owner-dashboard.server.ts");
  expect(server).toContain("await requireSuperAdmin();");
  expect(server).toContain("Promise.allSettled");
  expect(server).toContain("getServiceClient");
  expect(server).toContain("getR2Health");
  expect(server).not.toContain("getChannels");
  expect(server).toContain('rpc("owner_dashboard_snapshot")');
});

it("uses service-only dashboard RPC with browser roles revoked", () => {
  const migration = source("../supabase/migrations/20260824001000_owner_dashboard_rpc.sql");
  expect(migration).toContain("create or replace function public.owner_dashboard_snapshot()");
  expect(migration).toContain(
    "revoke all on function public.owner_dashboard_snapshot() from public, anon, authenticated;",
  );
  expect(migration).toContain(
    "grant execute on function public.owner_dashboard_snapshot() to service_role;",
  );
});
