import { useEffect, useRef } from "react";
import {
  releaseScreenWakeLock,
  requestScreenWakeLock,
  visibleWakeLockState,
  type WakeLockSentinelLike,
} from "../lib/screen-wake-lock";

export function useScreenWakeLock(enabled: boolean) {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    let disposed = false;
    const sync = () => {
      const action = visibleWakeLockState({
        active: enabled,
        sentinelActive: sentinelRef.current !== null,
        visibility: document.visibilityState,
      });
      if (action === "release") {
        releaseScreenWakeLock(sentinelRef.current);
        sentinelRef.current = null;
        return;
      }
      if (action === "request") {
        void requestScreenWakeLock().then((sentinel) => {
          if (disposed || !enabledRef.current) {
            releaseScreenWakeLock(sentinel);
            return;
          }
          sentinelRef.current = sentinel;
        });
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", sync);
      releaseScreenWakeLock(sentinelRef.current);
      sentinelRef.current = null;
    };
  }, [enabled]);
}