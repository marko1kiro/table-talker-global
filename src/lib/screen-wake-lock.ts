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

export type WakeLockSentinelLike = { release(): Promise<void> };

type WakeLockLike = { request(type: "screen"): Promise<WakeLockSentinelLike> };

type NavigatorWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

export async function requestScreenWakeLock(): Promise<WakeLockSentinelLike | null> {
  const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
  if (!wakeLock) return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}

export function releaseScreenWakeLock(sentinel: WakeLockSentinelLike | null | undefined) {
  if (!sentinel) return;
  void sentinel.release();
}
