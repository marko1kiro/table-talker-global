import { useCallback, useEffect, useRef } from "react";
import {
  enqueueEvent,
  getQueuedEvents,
  removeEvents,
  type PlaybackEvent,
} from "./event-queue";

const BATCH_SIZE = 10;
const FLUSH_INTERVAL_MS = 30_000;

type FlushFn = (events: PlaybackEvent[]) => Promise<{ ok: boolean; ids: string[] }>;

export function useEventFlush(flushToServer: FlushFn) {
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;

    try {
      const events = await getQueuedEvents();
      if (events.length === 0) return;

      const batch = events.slice(0, BATCH_SIZE);
      const result = await flushToServer(batch);

      if (result.ok) {
        await removeEvents(result.ids);
      }
    } catch {
      // Will retry on next flush
    } finally {
      flushingRef.current = false;
    }
  }, [flushToServer]);

  const recordEvent = useCallback(
    async (event: PlaybackEvent) => {
      await enqueueEvent(event);
      const events = await getQueuedEvents();
      if (events.length >= BATCH_SIZE) {
        await flush();
      }
    },
    [flush],
  );

  // Periodic flush
  useEffect(() => {
    const interval = setInterval(flush, FLUSH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [flush]);

  // Flush on pagehide
  useEffect(() => {
    const handlePageHide = () => {
      void flush();
    };

    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      // Use sendBeacon via pagehide
    }

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [flush]);

  return { recordEvent, flush };
}
