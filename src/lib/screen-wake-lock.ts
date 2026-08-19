export type WakeLockAction = "request" | "release" | "none";

export function visibleWakeLockState({
  active,
  sentinelActive,
  visibility,
}: {
  active: boolean;
  sentinelActive: boolean;
  visibility: string;
}): WakeLockAction {
  if (!active && sentinelActive) return "release";
  if (active && !sentinelActive && visibility === "visible") return "request";
  return "none";
}