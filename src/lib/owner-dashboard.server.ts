import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSuperAdmin } from "./auth.server";
import { clampDashboardSince, withTimeout, type HealthStatus } from "./owner-dashboard-domain";
import { getR2Health } from "./r2.server";
import { getServiceClient } from "./remote-audio.server";

export type OwnerDashboardAggregates = {
  total_restaurants: number;
  active_restaurants: number;
  plays_today: number;
  sync_failures: number;
  unresolved_errors: number;
};

const unavailable = (message: string): HealthStatus => ({ status: "unavailable", message });

type SnapshotCoreDependencies = {
  since: string;
  now?: number;
  rpc: (since: string) => Promise<OwnerDashboardAggregates>;
  r2Probe: () => Promise<HealthStatus>;
  apiProbe: () => Promise<HealthStatus>;
  timeout?: typeof withTimeout;
};

function isHealthStatus(value: unknown): value is HealthStatus {
  return typeof value === "object" && value !== null && "status" in value;
}

export async function getOwnerDashboardSnapshotCore({
  since,
  now,
  rpc,
  r2Probe,
  apiProbe,
  timeout = withTimeout,
}: SnapshotCoreDependencies) {
  const clampedSince = clampDashboardSince(since, now);

  const [databaseResult, r2Result, apiResult] = await Promise.allSettled([
    timeout(rpc(clampedSince), 4_000),
    timeout(r2Probe(), 4_000),
    timeout(apiProbe(), 4_000),
  ]);

  const database =
    databaseResult.status === "fulfilled"
      ? isHealthStatus(databaseResult.value)
        ? { health: databaseResult.value, aggregates: null }
        : { health: { status: "healthy" as const }, aggregates: databaseResult.value }
      : { health: unavailable("Database tidak merespons."), aggregates: null };
  const r2 = r2Result.status === "fulfilled" ? r2Result.value : unavailable("R2 tidak merespons.");
  const api =
    apiResult.status === "fulfilled" ? apiResult.value : unavailable("API tidak merespons.");

  return {
    health: {
      database: database.health,
      r2,
      api,
    },
    aggregates: database.aggregates,
  };
}

export const getOwnerDashboardSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const client = getServiceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const apiHealthUrl = new URL("/api/health", getRequest().url);
  const snapshot = await getOwnerDashboardSnapshotCore({
    since,
    rpc: async (p_since) => {
      if (!client) throw new Error("Supabase belum dikonfigurasi.");
      const { data, error } = await client.rpc("owner_dashboard_snapshot", { p_since });
      if (error || !data) throw new Error("Database tidak merespons.");
      return data as OwnerDashboardAggregates;
    },
    r2Probe: getR2Health,
    apiProbe: async () => {
      const response = await fetch(apiHealthUrl);
      return response.ok ? { status: "healthy" } : unavailable("API tidak merespons.");
    },
  });
  return {
    ...snapshot,
    deployment: process.env.VERCEL_ENV
      ? { provider: "vercel", environment: process.env.VERCEL_ENV }
      : null,
  };
});
