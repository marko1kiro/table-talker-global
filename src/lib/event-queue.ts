export type PlaybackEvent = {
  id: string;
  tenantToken: string;
  audioId: string;
  label: string;
  eventTimestamp: string;
  crewSessionId: string;
  deviceId: string;
  status: "played" | "failed";
  errorDetail?: string;
  // H-05 remediation (Fase 2, 2026-09-02): stamped once at first enqueue so
  // a batch stuck retrying indefinitely (e.g. an expired/revoked tenant
  // token that will never succeed) can eventually be dropped instead of
  // silently growing the queue forever. Optional/undefined for events
  // already sitting in IndexedDB from before this change -- treated as
  // "unknown age", never dead-lettered on age alone (see
  // isDeadLetterEvent below).
  enqueuedAt?: string;
  // Incremented by markFlushAttempts each time flushToServer rejects a
  // batch containing this event. Paired with enqueuedAt to bound retries
  // via isDeadLetterEvent.
  flushAttempts?: number;
};

let dbPromise: IDBDatabase | null = null;

const DB_NAME = "table-talker-events";
const DB_VERSION = 1;
const STORE_NAME = "playback_events";

// H-05 dead-letter budget: an event that has failed to flush this many
// times, or has been sitting in the queue this long, is dropped (with a
// console.warn) rather than retried forever. This is what stops one
// permanently-broken tenant/session from growing the queue without bound.
export const MAX_FLUSH_ATTEMPTS = 20;
export const DEAD_LETTER_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export function isDeadLetterEvent(
  event: Pick<PlaybackEvent, "flushAttempts" | "enqueuedAt">,
  now: number = Date.now(),
): boolean {
  if ((event.flushAttempts ?? 0) >= MAX_FLUSH_ATTEMPTS) return true;
  if (!event.enqueuedAt) return false;
  const enqueuedAtMs = Date.parse(event.enqueuedAt);
  if (Number.isNaN(enqueuedAtMs)) return false;
  return now - enqueuedAtMs > DEAD_LETTER_MAX_AGE_MS;
}

// H-05 remediation: previously event-flush.ts picked a batch from
// events[0]'s tenantToken and, on failure, returned out of the whole
// flush loop -- so if that tenant/token was the one failing (e.g. revoked
// session), no other tenant's queued events could ever be flushed in that
// pass, or any future pass, because the oldest-first sort kept selecting
// the same stuck tenant. This pure helper lets the flush loop skip
// tenants that have already failed *this flush call* and move on to the
// next group instead, without touching IndexedDB itself -- kept
// dependency-free so it's directly unit-testable (see
// tests/event-queue.test.ts).
export function pickNextTenantBatch(
  events: PlaybackEvent[],
  excludedTenantTokens: ReadonlySet<string>,
  batchSize: number,
): PlaybackEvent[] {
  const next = events.find((event) => !excludedTenantTokens.has(event.tenantToken));
  if (!next) return [];
  return events.filter((event) => event.tenantToken === next.tenantToken).slice(0, batchSize);
}

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return Promise.resolve(dbPromise);

  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => {
      dbPromise = request.result;
      resolve(request.result);
    };

    request.onerror = () => reject(request.error);
  });
}

export async function enqueueEvent(event: PlaybackEvent): Promise<void> {
  try {
    const db = await openDB();
    const stamped: PlaybackEvent = {
      ...event,
      enqueuedAt: event.enqueuedAt ?? new Date().toISOString(),
      flushAttempts: event.flushAttempts ?? 0,
    };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(stamped);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable — silently drop
  }
}

export async function getQueuedEvents(): Promise<PlaybackEvent[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () =>
        resolve(
          (req.result as PlaybackEvent[]).sort((left, right) =>
            left.eventTimestamp.localeCompare(right.eventTimestamp),
          ),
        );
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function removeEvents(ids: string[]): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

// H-05 remediation: called when flushToServer rejects a batch, so those
// events' retry counters advance even though they stay queued for
// another attempt. Read-modify-write per id inside one transaction.
export async function markFlushAttempts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const id of ids) {
        const getReq = store.get(id);
        getReq.onsuccess = () => {
          const record = getReq.result as PlaybackEvent | undefined;
          if (record) {
            store.put({
              ...record,
              flushAttempts: (record.flushAttempts ?? 0) + 1,
            });
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}

export async function clearQueuedEvents(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable
  }
}

export async function getEventCount(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return 0;
  }
}

export function generateEventId(): string {
  return crypto.randomUUID();
}

export function generateDeviceId(): string {
  const storageKey = "table-talker-device-id";
  try {
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(storageKey, id);
    return id;
  } catch {
    return "unknown-device";
  }
}
