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
  expect(server).toContain("apiProbe");
  expect(server).not.toContain("getChannels");
  expect(server).toContain('rpc("owner_dashboard_snapshot", { p_since: since })');
});

it("uses service-only dashboard RPC with browser roles revoked", () => {
  const migration = source("../supabase/migrations/20260824001000_owner_dashboard_rpc.sql");
  expect(migration).toContain(
    "create or replace function public.owner_dashboard_snapshot(p_since timestamptz)",
  );
  expect(migration).toContain(
    "resolved_at is null and occurred_at >= p_since and stage = 'sync_cache'",
  );
  expect(migration).toContain("operational_errors_unresolved_stage_occurred_idx");
  expect(migration).toContain(
    "revoke all on function public.owner_dashboard_snapshot(timestamptz) from public, anon, authenticated;",
  );
  expect(migration).toContain(
    "grant execute on function public.owner_dashboard_snapshot(timestamptz) to service_role;",
  );
});

it("keeps owner soundboard-free and makes operational metric cards navigable", () => {
  const dashboard = source("../src/routes/super-admin/index.tsx");
  const crew = source("../src/routes/index.tsx");
  expect(crew).toContain('import { SoundboardGrid } from "@/components/SoundboardGrid"');
  expect(dashboard).not.toContain("SoundboardGrid");
  expect(dashboard).toContain('to: "/super-admin/restaurants"');
  expect(dashboard).toContain('to: "/super-admin/history"');
  expect(dashboard).toContain('to: "/super-admin/error-log"');
  expect(dashboard).toContain("Reconnect realtime");
});

it("uses fixed R2 health object probe without exposing credentials", () => {
  const r2 = source("../src/lib/r2.server.ts");
  expect(r2).toContain('const R2_HEALTHCHECK_KEY = "healthcheck"');
  expect(r2).toContain("new HeadObjectCommand({ Bucket: R2_BUCKET, Key: R2_HEALTHCHECK_KEY })");
  expect(r2).toContain('error.name === "NotFound"');
  const healthHelper = r2.slice(r2.indexOf("export async function getR2Health"));
  expect(healthHelper).not.toContain("R2_SECRET_ACCESS_KEY");
});
