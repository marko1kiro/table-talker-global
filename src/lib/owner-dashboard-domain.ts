export const DASHBOARD_SYNC_FAILURE_STAGES = ["sync_cache"] as const;

export type HealthStatus = {
  status: "healthy" | "unavailable" | "timeout";
  message?: string;
};

export function mergeDashboardHealth<T extends Record<string, HealthStatus>>(
  health: T,
  realtime: HealthStatus,
): T & { realtime: HealthStatus } {
  return { ...health, realtime };
}

export function clampDashboardSince(value: string, now = Date.now()): string {
  const timestamp = Date.parse(value);
  const maximumAge = now - 30 * 24 * 60 * 60 * 1000;
  return new Date(
    Math.min(now, Math.max(maximumAge, Number.isNaN(timestamp) ? now : timestamp)),
  ).toISOString();
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
