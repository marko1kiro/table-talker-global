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
  if (!client) {
    return {
      health: mergeDashboardHealth({
        database: unavailable("Supabase belum dikonfigurasi."),
        r2: unavailable("R2 belum dikonfigurasi."),
        api: { status: "healthy" as const },
      }),
      aggregates: null,
    };
  }

  const [databaseResult, r2Result] = await Promise.allSettled([
    withTimeout(
      Promise.resolve(client.rpc("owner_dashboard_snapshot")).then(({ data, error }) =>
        error || !data
          ? { health: unavailable("Database tidak merespons."), aggregates: null }
          : { health: { status: "healthy" as const }, aggregates: data as Aggregates },
      ),
      4_000,
    ),
    withTimeout(getR2Health(), 4_000),
  ]);

  const database =
    databaseResult.status === "fulfilled"
      ? "health" in databaseResult.value
        ? databaseResult.value
        : { health: databaseResult.value, aggregates: null }
      : { health: unavailable("Database tidak merespons."), aggregates: null };
  const r2 = r2Result.status === "fulfilled" ? r2Result.value : unavailable("R2 tidak merespons.");

  return {
    health: mergeDashboardHealth({
      database: database.health,
      r2,
      api: { status: "healthy" as const },
    }),
    aggregates: database.aggregates,
  };
});
