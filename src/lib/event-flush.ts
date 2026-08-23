import { useCallback, useEffect, useRef } from "react";
import { enqueueEvent, getQueuedEvents, removeEvents, type PlaybackEvent } from "./event-queue";

const BATCH_SIZE = 10;
const MAX_BATCHES_PER_FLUSH = 5;
const FLUSH_INTERVAL_MS = 30_000;
const PAGEHIDE_MIRROR_LIMIT = BATCH_SIZE;

type FlushFn = (events: PlaybackEvent[]) => Promise<{ ok: boolean; ids: string[] }>;

export function useEventFlush(flushToServer: FlushFn) {
  const flushingRef = useRef(false);
  const pagehideEventsRef = useRef<PlaybackEvent[]>([]);

  const mirrorEvents = (events: PlaybackEvent[]) => {
    const byId = new Map(pagehideEventsRef.current.map((event) => [event.id, event]));
    events.forEach((event) => byId.set(event.id, event));
    pagehideEventsRef.current = [...byId.values()]
      .sort((left, right) => left.eventTimestamp.localeCompare(right.eventTimestamp))
      .slice(-PAGEHIDE_MIRROR_LIMIT);
  };

  useEffect(() => {
    void getQueuedEvents().then(mirrorEvents);
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;

    try {
      for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_FLUSH; batchIndex++) {
        const events = await getQueuedEvents();
        if (events.length === 0) return;
        const batch = events
          .filter((event) => event.tenantToken === events[0].tenantToken)
          .slice(0, BATCH_SIZE);
        const result = await flushToServer(batch);
        if (!result.ok) return;
        await removeEvents(result.ids);
        const removed = new Set(result.ids);
        pagehideEventsRef.current = pagehideEventsRef.current.filter((event) => !removed.has(event.id));
        if (batch.length < BATCH_SIZE) return;
      }
    } catch {
      // Will retry on next flush
    } finally {
      flushingRef.current = false;
    }
  }, [flushToServer]);

  const recordEvent = useCallback(
    async (event: PlaybackEvent) => {
      mirrorEvents([...pagehideEventsRef.current, event]);
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
      const events = pagehideEventsRef.current;
      const batch = events.filter((event) => event.tenantToken === events[0]?.tenantToken).slice(0, BATCH_SIZE);
      if (!batch.length) return;
      const body = JSON.stringify({ tenantToken: batch[0].tenantToken, events: batch });
      if (navigator.sendBeacon?.("/api/telemetry", new Blob([body], { type: "text/plain" }))) return;
      void fetch("/api/telemetry", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      });
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [flush]);

  return { recordEvent, flush };
}
