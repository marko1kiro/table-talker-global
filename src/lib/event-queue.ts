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
};

let dbPromise: IDBDatabase | null = null;

const DB_NAME = "table-talker-events";
const DB_VERSION = 1;
const STORE_NAME = "playback_events";

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
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(event);
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
