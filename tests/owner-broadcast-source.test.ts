import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const file = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

it("protects preview and send while resolving targets server-side", () => {
  const source = file("src/lib/owner-broadcast.server.ts");
  expect(source).toContain("await requireSuperAdmin()");
  expect(source).toContain("Promise.allSettled");
  expect(source).toContain("check_owner_broadcast_rate_limit");
  expect(source.indexOf("resolveBroadcastTargets")).toBeLessThan(
    source.indexOf('"check_owner_broadcast_rate_limit"'),
  );
  expect(source).not.toContain("deviceIds");
});

it("stores bounded service-role-only broadcast deliveries", () => {
  const migration = file("supabase/migrations/20260824004000_owner_broadcast.sql");
  expect(migration).toContain("owner_broadcasts");
  expect(migration).toContain("owner_broadcast_deliveries");
  expect(migration).toContain("create_owner_broadcast_delivery");
  expect(migration).toContain("check_owner_broadcast_rate_limit");
  expect(migration).toContain("grant execute");
  expect(migration).toContain("service_role");
});

it("renders preview, exact confirmation, and partial results", () => {
  const source = file("src/routes/super-admin/broadcast.tsx");
  expect(source).toContain("ALL_CONFIRMATION");
  expect(source).toContain("previewOwnerBroadcast");
  expect(source).toContain("sendOwnerBroadcast");
  expect(source).toContain("Hasil per resto");
});
