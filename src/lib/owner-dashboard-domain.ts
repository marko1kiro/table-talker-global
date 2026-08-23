export const DASHBOARD_SYNC_FAILURE_STAGES = ["sync_cache"] as const;

export type HealthStatus = {
  status: "healthy" | "unavailable" | "timeout";
  message?: string;
};

export function mergeDashboardHealth<T extends Record<string, HealthStatus>>(health: T): T {
  return health;
}

export function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T | HealthStatus> {
  return Promise.race([
    promise,
    new Promise<HealthStatus>((resolve) =>
      setTimeout(() => resolve({ status: "timeout", message: "Waktu habis." }), milliseconds),
    ),
  ]);
}
