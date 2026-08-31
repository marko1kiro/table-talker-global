import { describe, expect, it } from "vitest";
import {
  ESCORT_INTENT_WINDOW_MS,
  addEscortWaitEntry,
  escortWaitlistStorageKey,
  partitionEscortWaitlist,
  readEscortWaitlist,
  removeEscortWaitEntry,
  writeEscortWaitlist,
  type EscortWaitEntry,
} from "../src/lib/satgas-escort-waitlist";

function storage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const SESSION_A = "role-session-aaaa";
const SESSION_B = "role-session-bbbb";

describe("ESCORT_INTENT_WINDOW_MS", () => {
  it("is exactly 30 minutes, matching the create_escort_intent RPC's server-side expiry", () => {
    expect(ESCORT_INTENT_WINDOW_MS).toBe(30 * 60 * 1000);
  });
});

describe("escortWaitlistStorageKey", () => {
  it("scopes the key per role_session_id, so a fresh session never shares another session's key", () => {
    expect(escortWaitlistStorageKey(SESSION_A)).toBe(
      "table-talker.satgas-escort-waitlist.role-session-aaaa",
    );
    expect(escortWaitlistStorageKey(SESSION_A)).not.toBe(escortWaitlistStorageKey(SESSION_B));
  });
});

describe("readEscortWaitlist", () => {
  it("returns [] when storage is null", () => {
    expect(readEscortWaitlist(null, SESSION_A)).toEqual([]);
  });

  it("returns [] when nothing has been stored yet for this session", () => {
    expect(readEscortWaitlist(storage(), SESSION_A)).toEqual([]);
  });

  it("reads back a persisted list", () => {
    const entries: EscortWaitEntry[] = [{ intentId: "intent-1", tableNumber: 4, expiresAt: 1000 }];
    const session = storage({
      [escortWaitlistStorageKey(SESSION_A)]: JSON.stringify(entries),
    });
    expect(readEscortWaitlist(session, SESSION_A)).toEqual(entries);
  });

  it("isolates lists per role_session_id -- session B never sees session A's entries", () => {
    const entries: EscortWaitEntry[] = [{ intentId: "intent-1", tableNumber: 4, expiresAt: 1000 }];
    const session = storage({
      [escortWaitlistStorageKey(SESSION_A)]: JSON.stringify(entries),
    });
    expect(readEscortWaitlist(session, SESSION_B)).toEqual([]);
  });

  it("clears and returns [] for malformed JSON rather than throwing", () => {
    const session = storage({ [escortWaitlistStorageKey(SESSION_A)]: "{not json" });
    expect(readEscortWaitlist(session, SESSION_A)).toEqual([]);
    expect(session.getItem(escortWaitlistStorageKey(SESSION_A))).toBeNull();
  });

  it("clears and returns [] when the stored value is not an array", () => {
    const session = storage({
      [escortWaitlistStorageKey(SESSION_A)]: JSON.stringify({ intentId: "x" }),
    });
    expect(readEscortWaitlist(session, SESSION_A)).toEqual([]);
    expect(session.getItem(escortWaitlistStorageKey(SESSION_A))).toBeNull();
  });

  it("silently drops entries with the wrong shape instead of throwing", () => {
    const session = storage({
      [escortWaitlistStorageKey(SESSION_A)]: JSON.stringify([
        { intentId: "intent-1", tableNumber: 4, expiresAt: 1000 },
        { intentId: "intent-2" },
        "garbage",
        null,
      ]),
    });
    expect(readEscortWaitlist(session, SESSION_A)).toEqual([
      { intentId: "intent-1", tableNumber: 4, expiresAt: 1000 },
    ]);
  });
});

describe("writeEscortWaitlist", () => {
  it("persists a list that is then read back (same storage instance)", () => {
    const session = storage();
    const entries: EscortWaitEntry[] = [{ intentId: "intent-1", tableNumber: 4, expiresAt: 1000 }];
    writeEscortWaitlist(session, SESSION_A, entries);
    expect(readEscortWaitlist(session, SESSION_A)).toEqual(entries);
  });

  it("does not throw when storage is null", () => {
    expect(() => writeEscortWaitlist(null, SESSION_A, [])).not.toThrow();
  });

  it("does not throw when storage.setItem throws", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(() => writeEscortWaitlist(throwing, SESSION_A, [])).not.toThrow();
  });
});

describe("addEscortWaitEntry", () => {
  it("appends a new entry and returns the updated list", () => {
    const session = storage();
    const result = addEscortWaitEntry(session, SESSION_A, {
      intentId: "intent-1",
      tableNumber: 4,
      expiresAt: 1000,
    });
    expect(result).toEqual([{ intentId: "intent-1", tableNumber: 4, expiresAt: 1000 }]);
    expect(readEscortWaitlist(session, SESSION_A)).toEqual(result);
  });

  it("replaces an existing entry with the same intentId rather than duplicating it", () => {
    const session = storage();
    addEscortWaitEntry(session, SESSION_A, {
      intentId: "intent-1",
      tableNumber: 4,
      expiresAt: 1000,
    });
    const result = addEscortWaitEntry(session, SESSION_A, {
      intentId: "intent-1",
      tableNumber: 4,
      expiresAt: 2000,
    });
    expect(result).toEqual([{ intentId: "intent-1", tableNumber: 4, expiresAt: 2000 }]);
  });
});

describe("removeEscortWaitEntry", () => {
  it("removes only the matching intentId, keeping other entries", () => {
    const session = storage();
    addEscortWaitEntry(session, SESSION_A, {
      intentId: "intent-1",
      tableNumber: 4,
      expiresAt: 1000,
    });
    addEscortWaitEntry(session, SESSION_A, {
      intentId: "intent-2",
      tableNumber: 7,
      expiresAt: 2000,
    });
    const result = removeEscortWaitEntry(session, SESSION_A, "intent-1");
    expect(result).toEqual([{ intentId: "intent-2", tableNumber: 7, expiresAt: 2000 }]);
    expect(readEscortWaitlist(session, SESSION_A)).toEqual(result);
  });

  it("is a no-op (returns the same entries) when the intentId is not present", () => {
    const session = storage();
    addEscortWaitEntry(session, SESSION_A, {
      intentId: "intent-1",
      tableNumber: 4,
      expiresAt: 1000,
    });
    const result = removeEscortWaitEntry(session, SESSION_A, "does-not-exist");
    expect(result).toEqual([{ intentId: "intent-1", tableNumber: 4, expiresAt: 1000 }]);
  });
});

describe("partitionEscortWaitlist", () => {
  const entry = (over: Partial<EscortWaitEntry>): EscortWaitEntry => ({
    intentId: "intent-1",
    tableNumber: 4,
    expiresAt: 10_000,
    ...over,
  });

  it("keeps an entry in stillWaiting when its table is kosong and the window has not elapsed", () => {
    const result = partitionEscortWaitlist(
      [entry({})],
      [{ tableNumber: 4, status: "kosong" }],
      9_999,
    );
    expect(result.stillWaiting).toHaveLength(1);
    expect(result.readyToConfirm).toHaveLength(0);
    expect(result.autoCleared).toHaveLength(0);
  });

  it("moves an entry to readyToConfirm the instant now >= expiresAt while the table is still kosong", () => {
    const result = partitionEscortWaitlist(
      [entry({})],
      [{ tableNumber: 4, status: "kosong" }],
      10_000,
    );
    expect(result.readyToConfirm).toHaveLength(1);
    expect(result.stillWaiting).toHaveLength(0);
  });

  it("treats a table missing from the snapshot as kosong (defaults, never looks broken)", () => {
    const result = partitionEscortWaitlist([entry({})], [], 10_000);
    expect(result.readyToConfirm).toHaveLength(1);
  });

  it("auto-clears an entry the moment its table becomes terisi, even before the window elapses", () => {
    const result = partitionEscortWaitlist(
      [entry({})],
      [{ tableNumber: 4, status: "terisi" }],
      1_000, // well before expiresAt: 10_000
    );
    expect(result.autoCleared).toHaveLength(1);
    expect(result.readyToConfirm).toHaveLength(0);
    expect(result.stillWaiting).toHaveLength(0);
  });

  it("auto-clears (never prompts) even after the window has also elapsed", () => {
    const result = partitionEscortWaitlist(
      [entry({})],
      [{ tableNumber: 4, status: "terisi" }],
      99_999,
    );
    expect(result.autoCleared).toHaveLength(1);
    expect(result.readyToConfirm).toHaveLength(0);
  });

  it("partitions a mixed list of several entries independently", () => {
    const result = partitionEscortWaitlist(
      [
        entry({ intentId: "waiting", tableNumber: 1, expiresAt: 20_000 }),
        entry({ intentId: "ready", tableNumber: 2, expiresAt: 5_000 }),
        entry({ intentId: "cleared", tableNumber: 3, expiresAt: 5_000 }),
      ],
      [
        { tableNumber: 1, status: "kosong" },
        { tableNumber: 2, status: "kosong" },
        { tableNumber: 3, status: "terisi" },
      ],
      10_000,
    );
    expect(result.stillWaiting.map((e) => e.intentId)).toEqual(["waiting"]);
    expect(result.readyToConfirm.map((e) => e.intentId)).toEqual(["ready"]);
    expect(result.autoCleared.map((e) => e.intentId)).toEqual(["cleared"]);
  });
});
