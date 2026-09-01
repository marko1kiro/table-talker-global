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

// M-04/M-05 remediation (Fase 3, 2026-09-02): the IndexedDB store above is
// shared by every tab/session open on the same browser origin -- there is
// no per-tab isolation. `clearQueuedEvents()` used to take no arguments
// and call `.clear()` on the whole object store, so logging out one
// tab/session (or even an unrelated info page via useCrewLogout) silently
// wiped every *other* tab/session's still-queued, not-yet-flushed
// telemetry too (M-04).
//
// Each PlaybackEvent already carries its own `tenantToken` and
// `crewSessionId`, so a session's own events can be identified without
// adding a new field: `sessionScopeKey` combines the two into the
// partition key used below.
export function sessionScopeKey(tenantToken: string, crewSessionId: string): string {
  return `${tenantToken}:${crewSessionId}`;
}

// M-05: `recordEvent`'s `enqueueEvent` and a logout's `clearQueuedEvents`
// open independent IndexedDB transactions. Because both are async and
// resolve through their own `await openDB()` before creating a
// transaction, an enqueue already in flight when a clear fires is not
// guaranteed to lose the race -- its `put()` transaction could still be
// created and commit *after* the clear's `.clear()` already ran, quietly
// reviving a stale event right after logout.
//
// `sessionGenerations` is a synchronous, in-memory fence per scope.
// `clearQueuedEvents` bumps it *before* any await, so any `enqueueEvent`
// call for the same scope that hasn't yet reached its post-`openDB()`
// check will observe the bump and drop its write instead of resurrecting
// a stale event. It intentionally lives only in memory (not persisted):
// it only needs to win a race against work already in flight in this
// same page's lifetime, not survive reloads.
const sessionGenerations = new Map<string, number>();

function currentSessionGeneration(scope: string): number {
  return sessionGenerations.get(scope) ?? 0;
}

export function bumpSessionGeneration(scope: string): number {
  const next = currentSessionGeneration(scope) + 1;
  sessionGenerations.set(scope, next);
  return next;
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
  // M-05 fencing: captured synchronously, before the first await, so it
  // reflects the generation in effect at the moment this call started.
  const scope = sessionScopeKey(event.tenantToken, event.crewSessionId);
  const generationAtCall = currentSessionGeneration(scope);
  try {
    const db = await openDB();
    // Re-check right before writing: if this scope's generation moved on
    // while we were opening the DB, a clearQueuedEvents() for this same
    // session ran concurrently. Drop this write instead of reviving a
    // stale event after that clear.
    if (currentSessionGeneration(scope) !== generationAtCall) return;
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

// M-04: scoped to a single session (tenantToken + crewSessionId) instead
// of the old no-arg `.clear()` that wiped every tab/session sharing this
// origin's IndexedDB store. M-05: bumps the session's generation fence
// synchronously, before any await, so a same-scope `enqueueEvent` already
// in flight drops its write instead of reappearing after this resolves.
// Callers must `await` this (not `void`) so the deletion has actually
// committed before they proceed (e.g. navigate away).
export async function clearQueuedEvents(tenantToken: string, crewSessionId: string): Promise<void> {
  const scope = sessionScopeKey(tenantToken, crewSessionId);
  bumpSessionGeneration(scope);
  try {
    const events = await getQueuedEvents();
    const ids = events
      .filter((event) => sessionScopeKey(event.tenantToken, event.crewSessionId) === scope)
      .map((event) => event.id);
    await removeEvents(ids);
  } catch {
    // IndexedDB unavailable
  }
}

// Test-only: clears all rows from the store and resets the in-memory
// generation fences, so each test in tests/event-queue.test.ts starts
// from a clean slate. Keeps the same DB connection open across tests
// (rather than deleting/recreating the database) to avoid flaky
// open/delete races in fake-indexeddb between tests. Never called from
// application code.
export async function __resetEventQueueForTests(): Promise<void> {
  sessionGenerations.clear();
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // IndexedDB unavailable in this environment — nothing to reset.
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
