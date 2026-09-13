// Poin 3 fix: pure decision matrix for the /manager boot guard. No React: the
// handoff-corpse and in-flight-settle outcomes are all observable here, which
// is exactly where the pre-fix race lived (see manager-boot-guard.ts header).
import { describe, expect, it } from "vitest";
import { bootManagerDashboard } from "@/lib/manager-boot-guard";
import type { StorageLike } from "@/lib/manager-session-identity";

const IDENTITY_KEY = "table-talker.manager-identity";
const PENDING_KEY = "table-talker.manager-pending-handoff";

function memStorage(initial: Record<string, string> = {}): StorageLike & Record<string, string> {
  const data: Record<string, string> = { ...initial };
  return {
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
    removeItem: (key: string) => {
      delete data[key];
    },
  } as unknown as StorageLike & Record<string, string>;
}

const identity = {
  idManager: "mgr01",
  fullName: "Man A",
  restaurantId: "r1",
  restaurantDisplayName: "Resto Satu",
  restaurantCode: "R1",
  managerToken: "bearer-1",
  accessToken: "carrier-jwt",
};
const pending = { ...identity, rateLimitReservationId: "res-1" };

function keys(idt = identity, pend = pending) {
  return {
    [IDENTITY_KEY]: JSON.stringify(idt),
    [PENDING_KEY]: JSON.stringify(pend),
  };
}

// wait resolves synchronously per poll; onTick lets a test mutate storage while
// the guard waits for the handoff owner to settle.
function settleOnTick(
  storage: ReturnType<typeof memStorage>,
  onTick: (tick: number, storage: ReturnType<typeof memStorage>) => void,
) {
  let tick = 0;
  return {
    wait: async () => {
      tick += 1;
      onTick(tick, storage);
    },
  };
}

const IDLE = { wait: async () => undefined };

describe("bootManagerDashboard", () => {
  it("no pending, identity stored: hydrate without touching storage", async () => {
    const storage = memStorage({ [IDENTITY_KEY]: JSON.stringify(identity) });
    const out = await bootManagerDashboard(storage, IDLE);
    expect(out).toEqual({ identity, removeIdentity: false });
    expect(storage.getItem(IDENTITY_KEY)).not.toBeNull();
  });

  it("no pending, no identity: bounce, nothing to remove", async () => {
    const storage = memStorage();
    const out = await bootManagerDashboard(storage, IDLE);
    expect(out.identity).toBeNull();
    expect(out.removeIdentity).toBe(false);
  });

  it("null storage: bounce-safe (no throw)", async () => {
    const out = await bootManagerDashboard(null, IDLE);
    expect(out).toEqual({ identity: null, removeIdentity: false });
  });

  it("pending with foreign bearer beside an identity: instant bounce + drop the untrusted identity", async () => {
    const storage = memStorage(keys(identity, { ...pending, managerToken: "bearer-9" }));
    const out = await bootManagerDashboard(storage, { ...IDLE, intervalMs: 1, maxAttempts: 3 });
    expect(out.identity).toBeNull();
    expect(out.removeIdentity).toBe(true);
  });

  it("matching pending but NO identity: bounce + keep the record (pending-only case)", async () => {
    const storage = memStorage({ [PENDING_KEY]: JSON.stringify(pending) });
    const out = await bootManagerDashboard(storage, { ...IDLE, intervalMs: 1, maxAttempts: 3 });
    expect(out.identity).toBeNull();
    expect(out.removeIdentity).toBe(true);
  });

  it("in-flight handoff settles (confirm ok) during the window: hydrate the fresh identity", async () => {
    const storage = memStorage(keys());
    const out = await bootManagerDashboard(storage, {
      ...settleOnTick(storage, (tick, s) => {
        if (tick === 2) s.removeItem(PENDING_KEY); // owner confirms on the 2nd poll
      }),
      intervalMs: 1,
      maxAttempts: 12,
    });
    expect(out).toEqual({ identity, removeIdentity: false });
  });

  it("handoff fails definitively during the window: pending+identity already gone -> bounce", async () => {
    const storage = memStorage(keys());
    const out = await bootManagerDashboard(storage, {
      ...settleOnTick(storage, (tick, s) => {
        if (tick === 1) {
          s.removeItem(PENDING_KEY);
          s.removeItem(IDENTITY_KEY);
        }
      }),
      intervalMs: 1,
      maxAttempts: 12,
    });
    expect(out.identity).toBeNull();
    expect(out.removeIdentity).toBe(false); // nothing left to drop
  });

  it("corpse record that never settles: bounce + drop identity AFTER exhausting the grace window, keep the record", async () => {
    const storage = memStorage(keys());
    const out = await bootManagerDashboard(storage, { intervalMs: 1, maxAttempts: 4, ...IDLE });
    expect(out.identity).toBeNull();
    expect(out.removeIdentity).toBe(true);
    // Recovery record survives untouched so the next submit resumes this pair.
    expect(JSON.parse(storage.getItem(PENDING_KEY) as string)).toEqual(pending);
  });

  it("defaults bound the real window at 12 x 400ms", async () => {
    const storage = memStorage(keys());
    const t0 = Date.now();
    const out = await bootManagerDashboard(storage, {
      wait: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    });
    const elapsed = Date.now() - t0;
    expect(out.removeIdentity).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(4400);
    expect(elapsed).toBeLessThan(7000);
  }, 15000);
});
