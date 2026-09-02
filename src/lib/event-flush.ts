import { useCallback, useEffect, useRef } from "react";
import {
  enqueueEvent,
  getQueuedEvents,
  isDeadLetterEvent,
  markFlushAttempts,
  pickNextTenantBatch,
  removeEvents,
  type PlaybackEvent,
} from "./event-queue";

const BATCH_SIZE = 10;
const MAX_BATCHES_PER_FLUSH = 5;
const FLUSH_INTERVAL_MS = 30_000;
const PAGEHIDE_MIRROR_LIMIT = BATCH_SIZE;

type FlushFn = (events: PlaybackEvent[]) => Promise<{ ok: boolean; ids: string[] }>;

export function useEventFlush(flushToServer: FlushFn, getCrewSessionToken: () => string) {
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
      // H-05 remediation (Fase 2, 2026-09-02): previously a failed batch
      // caused this whole function to `return` immediately, so one
      // tenant/token that could never succeed (e.g. revoked session)
      // starved every other tenant's queued events -- since
      // getQueuedEvents() is sorted oldest-first, the next flush call
      // would just pick that same stuck tenant's events again and bail
      // out again, forever. `failedTenants` tracks who has already failed
      // *this* flush call so the loop can skip past them and keep making
      // progress on other tenants/groups in the same pass.
      const failedTenants = new Set<string>();

      for (let batchIndex = 0; batchIndex < MAX_BATCHES_PER_FLUSH; batchIndex++) {
        const events = await getQueuedEvents();
        if (events.length === 0) return;

        // Dead-letter: drop events that have exhausted their retry/TTL
        // budget (see isDeadLetterEvent) so a permanently-broken batch
        // doesn't accumulate in the queue forever.
        const now = Date.now();
        const deadIds = events.filter((event) => isDeadLetterEvent(event, now)).map((e) => e.id);
        if (deadIds.length > 0) {
          console.warn(
            `[event-flush] dropping ${deadIds.length} event(s) that exceeded the retry/TTL budget (dead-letter)`,
          );
          await removeEvents(deadIds);
        }
        const alive = deadIds.length > 0 ? events.filter((e) => !deadIds.includes(e.id)) : events;

        const batch = pickNextTenantBatch(alive, failedTenants, BATCH_SIZE);
        if (batch.length === 0) return; // everything left this pass belongs to an already-failed tenant

        const result = await flushToServer(batch);
        if (!result.ok) {
          failedTenants.add(batch[0].tenantToken);
          await markFlushAttempts(batch.map((event) => event.id));
          continue; // keep going -- try another tenant/group instead of aborting the whole flush
        }

        await removeEvents(result.ids);
        const removed = new Set(result.ids);
        pagehideEventsRef.current = pagehideEventsRef.current.filter(
          (event) => !removed.has(event.id),
        );
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
      const batch = events
        .filter((event) => event.tenantToken === events[0]?.tenantToken)
        .slice(0, BATCH_SIZE);
      if (!batch.length) return;
      const crewSessionToken = getCrewSessionToken();
      const body = JSON.stringify({
        tenantToken: batch[0].tenantToken,
        crewSessionToken,
        events: batch,
      });
      if (navigator.sendBeacon?.("/api/telemetry", new Blob([body], { type: "text/plain" })))
        return;
      // L-03: best-effort unload delivery -- the fetch must handle its own
      // rejection so a failed unload flush never becomes an unhandled
      // promise rejection. The durable IndexedDB queue remains the source
      // of truth and the next flush pass retries these events.
      void fetch("/api/telemetry", {
        method: "POST",
        body,
        headers: { "content-type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [getCrewSessionToken, flush]);

  return { recordEvent, flush };
}
