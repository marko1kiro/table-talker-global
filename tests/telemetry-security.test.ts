import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

it("derives playback tenant identity from verified tenant token", () => {
  const playback = source("../src/lib/playback-events.server.ts");
  expect(playback).toContain("tenantToken: z.string()");
  expect(playback).toContain("verifyActiveTenantSession");
  expect(playback).toContain("restaurant_id: tenant.restaurantId");
  expect(playback).not.toContain("restaurant_id: e.restaurantId");
  expect(playback).not.toContain("crew_session_id: e.crewSessionId");
});

it("derives operational-error tenant identity from verified tenant token", () => {
  const errors = source("../src/lib/operational-errors.server.ts");
  expect(errors).toContain("tenantToken: z.string()");
  expect(errors).toContain("verifyActiveTenantSession");
  expect(errors).toContain("restaurant_id: tenant.restaurantId");
  expect(errors).not.toContain("restaurant_id: data.error.restaurantId");
});

it("requires playback restaurant_id and records actual claimed crew session ID", () => {
  const migration = source("../supabase/migrations/20260823103500_secure_telemetry.sql");
  expect(migration).toMatch(/alter column restaurant_id set not null/i);

  const identity = source("../src/lib/crew-session-identity.ts");
  expect(identity).toContain("crewSessionId: string");

  const index = source("../src/routes/index.tsx");
  expect(index).toContain('crewSessionId: crewIdentityRef.current?.crewSessionId ?? ""');
  expect(index).not.toContain('crewSessionId: crewIdentity?.restaurantId ?? ""');
});

it("uses current crew identity when playback callback runs", () => {
  const index = source("../src/routes/index.tsx");
  expect(index).toContain("crewIdentityRef.current");
});

it("records browser playing events without claiming playback completed", () => {
  const index = source("../src/routes/index.tsx");
  expect(index).toContain("await controller.play");
  expect(index).toContain('status: "played"');
});
