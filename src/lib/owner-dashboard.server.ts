import { createServerFn } from "@tanstack/react-start";
import { requireSuperAdmin } from "./auth.server";
import { mergeDashboardHealth, withTimeout, type HealthStatus } from "./owner-dashboard-domain";
import { getR2Health } from "./r2.server";
import { getServiceClient } from "./remote-audio.server";

type Aggregates = {
  total_restaurants: number;
  active_restaurants: number;
  active_crew_devices: number;
  plays_today: number;
  sync_failures: number;
  unresolved_errors: number;
};

const unavailable = (message: string): HealthStatus => ({ status: "unavailable", message });

export const getOwnerDashboardSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  const client = getServiceClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const apiProbe = Promise.resolve({ status: "healthy" as const });
  const databaseProbe = client
    ? Promise.resolve(client.rpc("owner_dashboard_snapshot", { p_since: since })).then(
        ({ data, error }) =>
          error || !data
            ? { health: unavailable("Database tidak merespons."), aggregates: null }
            : { health: { status: "healthy" as const }, aggregates: data as Aggregates },
      )
    : Promise.resolve({ health: unavailable("Supabase belum dikonfigurasi."), aggregates: null });

  const [databaseResult, r2Result, apiResult] = await Promise.allSettled([
    withTimeout(databaseProbe, 4_000),
    withTimeout(getR2Health(), 4_000),
    withTimeout(apiProbe, 4_000),
  ]);

  const database =
    databaseResult.status === "fulfilled"
      ? "health" in databaseResult.value
        ? databaseResult.value
        : { health: databaseResult.value, aggregates: null }
      : { health: unavailable("Database tidak merespons."), aggregates: null };
  const r2 = r2Result.status === "fulfilled" ? r2Result.value : unavailable("R2 tidak merespons.");
  const api =
    apiResult.status === "fulfilled" && apiResult.value.status === "healthy"
      ? apiResult.value
      : unavailable("API tidak merespons.");

  return {
    health: mergeDashboardHealth({
      database: database.health,
      r2,
      api,
    }),
    aggregates: database.aggregates,
  };
});
