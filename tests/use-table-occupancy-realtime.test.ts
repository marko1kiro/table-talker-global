import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTableOccupancyRealtimeController,
  POLL_FALLBACK_MS,
  REFETCH_RATE_LIMIT_MS,
  tableOccupancyChannelName,
} from "../src/hooks/use-table-occupancy-realtime";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";

type BroadcastCallback = (payload: unknown) => void;
type StatusCallback = (status: string) => void;

function fakeChannel() {
  let broadcastCallback: BroadcastCallback | null = null;
  let statusCallback: StatusCallback | null = null;
  const channel = {
    on: vi.fn((_type: "broadcast", _filter: { event: string }, callback: BroadcastCallback) => {
      broadcastCallback = callback;
      return channel;
    }),
    subscribe: vi.fn((callback: StatusCallback) => {
      statusCallback = callback;
      return channel;
    }),
  };
  return {
    channel,
    emitInvalidate: (revision?: number) =>
      broadcastCallback?.(revision === undefined ? undefined : { payload: { revision } }),
    emitStatus: (status: string) => statusCallback?.(status),
  };
}

function fakeClient() {
  const channels = new Map<string, ReturnType<typeof fakeChannel>>();
  const removeChannel = vi.fn();
  const client = {
    channel: vi.fn((name: string) => {
      const created = fakeChannel();
      channels.set(name, created);
      return created.channel;
    }),
    removeChannel,
  };
  return { client, channels, removeChannel };
}

function fakeVisibility(initiallyVisible = true) {
  let visible = initiallyVisible;
  let callback: (() => void) | null = null;
  const unsubscribe = vi.fn(() => {
    callback = null;
  });
  const visibility = {
    isVisible: () => visible,
    subscribe: vi.fn((next: () => void) => {
      callback = next;
      return unsubscribe;
    }),
  };
  return {
    visibility,
    unsubscribe,
    setVisible(next: boolean) {
      visible = next;
      callback?.();
    },
  };
}

describe("tableOccupancyChannelName", () => {
  it("uses the table-occupancy:{restaurantId} channel name shape", () => {
    expect(tableOccupancyChannelName(RESTAURANT_ID)).toBe(`table-occupancy:${RESTAURANT_ID}`);
  });
});

describe("createTableOccupancyRealtimeController", () => {
  it("subscribes to the per-restaurant broadcast channel and invokes refetch on invalidate", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    createTableOccupancyRealtimeController({ client, restaurantId: RESTAURANT_ID, refetch });

    expect(client.channel).toHaveBeenCalledWith(`table-occupancy:${RESTAURANT_ID}`);
    const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;
    expect(entry.channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "invalidate" },
      expect.any(Function),
    );

    entry.emitInvalidate();
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("ignores stale revisions and refetches when a newer or gapped revision arrives", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    let currentRevision = 4;
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      refetch,
      getCurrentRevision: () => currentRevision,
    });
    const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

    entry.emitInvalidate(3);
    entry.emitInvalidate(4);
    expect(refetch).not.toHaveBeenCalled();

    entry.emitInvalidate(6); // revision 5 was missed
    expect(refetch).toHaveBeenCalledTimes(1);

    currentRevision = 6;
    entry.emitInvalidate(6); // duplicate delivery
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("rate-limits refetch to at most once per second", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    let currentTime = 0;
    createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      refetch,
      now: () => currentTime,
    });
    const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

    entry.emitInvalidate();
    expect(refetch).toHaveBeenCalledTimes(1);

    currentTime += REFETCH_RATE_LIMIT_MS - 1;
    entry.emitInvalidate();
    expect(refetch).toHaveBeenCalledTimes(1); // still within the 1/sec window

    currentTime += 1;
    entry.emitInvalidate();
    expect(refetch).toHaveBeenCalledTimes(2); // exactly at the boundary, allowed
  });

  it("falls back to interval polling whenever the channel is not SUBSCRIBED", () => {
    vi.useFakeTimers();
    try {
      const { client, channels } = fakeClient();
      const refetch = vi.fn();
      createTableOccupancyRealtimeController({ client, restaurantId: RESTAURANT_ID, refetch });
      const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

      entry.emitStatus("CHANNEL_ERROR");
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
      expect(refetch).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(POLL_FALLBACK_MS);
      expect(refetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps light safety polling active even while SUBSCRIBED", () => {
    vi.useFakeTimers();
    try {
      const { client, channels } = fakeClient();
      const refetch = vi.fn();
      createTableOccupancyRealtimeController({ client, restaurantId: RESTAURANT_ID, refetch });
      const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

      entry.emitStatus("SUBSCRIBED");
      vi.advanceTimersByTime(POLL_FALLBACK_MS * 3);
      expect(refetch).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to polling immediately when no Supabase client is available", () => {
    vi.useFakeTimers();
    try {
      const refetch = vi.fn();
      const onStatusChange = vi.fn();
      createTableOccupancyRealtimeController({
        client: null,
        restaurantId: RESTAURANT_ID,
        refetch,
        onStatusChange,
      });

      expect(onStatusChange).toHaveBeenCalledWith("CHANNEL_ERROR");
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("pauses fallback polling while hidden and resumes it when visible", () => {
    vi.useFakeTimers();
    try {
      const { client, channels } = fakeClient();
      const { visibility, setVisible } = fakeVisibility(true);
      const refetch = vi.fn();
      createTableOccupancyRealtimeController({
        client,
        restaurantId: RESTAURANT_ID,
        refetch,
        visibility,
      });
      const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

      entry.emitStatus("CHANNEL_ERROR");
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
      expect(refetch).toHaveBeenCalledTimes(1);

      setVisible(false);
      vi.advanceTimersByTime(POLL_FALLBACK_MS * 3);
      expect(refetch).toHaveBeenCalledTimes(1);

      setVisible(true);
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
      expect(refetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start fallback polling until a hidden page becomes visible", () => {
    vi.useFakeTimers();
    try {
      const { client, channels } = fakeClient();
      const { visibility, setVisible } = fakeVisibility(false);
      const refetch = vi.fn();
      createTableOccupancyRealtimeController({
        client,
        restaurantId: RESTAURANT_ID,
        refetch,
        visibility,
      });
      const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

      entry.emitStatus("TIMED_OUT");
      vi.advanceTimersByTime(POLL_FALLBACK_MS * 2);
      expect(refetch).not.toHaveBeenCalled();

      setVisible(true);
      vi.advanceTimersByTime(POLL_FALLBACK_MS);
      expect(refetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cleans up: removes the channel and stops the polling interval on dispose", () => {
    vi.useFakeTimers();
    try {
      const { client, channels, removeChannel } = fakeClient();
      const refetch = vi.fn();
      const controller = createTableOccupancyRealtimeController({
        client,
        restaurantId: RESTAURANT_ID,
        refetch,
      });
      const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;
      entry.emitStatus("CHANNEL_ERROR");

      controller.dispose();

      expect(removeChannel).toHaveBeenCalledWith(entry.channel);
      vi.advanceTimersByTime(POLL_FALLBACK_MS * 3);
      expect(refetch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never calls refetch after dispose, even on a still-in-flight invalidate", () => {
    const { client, channels } = fakeClient();
    const refetch = vi.fn();
    const controller = createTableOccupancyRealtimeController({
      client,
      restaurantId: RESTAURANT_ID,
      refetch,
    });
    const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;

    controller.dispose();
    entry.emitInvalidate();
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("no-heartbeat architectural invariant", () => {
  // This suite exists specifically to prevent regressing back toward the
  // removed heartbeat/presence pattern (see the deleted crew-remote-relay hook module
  // at git rev ee77d6b). The only outbound side effect this module may
  // ever perform is calling the caller-provided refetch -- never a
  // bespoke heartbeat/keep-alive RPC, never a fixed-interval ping that
  // isn't the documented polling fallback.

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("never calls any RPC-like heartbeat while subscribed; only the light safety poll refetches", () => {
    const { client, channels } = fakeClient();
    const rpc = vi.fn();
    const refetch = vi.fn();
    createTableOccupancyRealtimeController({ client, restaurantId: RESTAURANT_ID, refetch });
    const entry = channels.get(`table-occupancy:${RESTAURANT_ID}`)!;
    entry.emitStatus("SUBSCRIBED");

    vi.advanceTimersByTime(60_000);

    expect(rpc).not.toHaveBeenCalled();
    expect(refetch).toHaveBeenCalledTimes(5);
  });

  const hookSource = readFileSync(
    new URL("../src/hooks/use-table-occupancy-realtime.ts", import.meta.url),
    "utf8",
  );

  it("contains no heartbeat/presence RPC calls or heartbeat timer constants", () => {
    expect(hookSource).not.toMatch(/heartbeat/i);
    expect(hookSource).not.toContain("claim_crew_session");
    expect(hookSource).not.toContain("HEARTBEAT_MS");
    // Task 16 allows visibilitychange solely to pause/resume the documented
    // fallback poll. It must never be used to reconnect or call an RPC.
    expect(hookSource).toContain("visibilitychange");
    expect(hookSource).not.toContain("pagehide");
    expect(hookSource).not.toMatch(/\.subscribe\([^)]*visibility/i);
  });

  it("uses broadcast/invalidate events, not postgres_changes", () => {
    expect(hookSource).toContain('"broadcast"');
    expect(hookSource).toContain('{ event: "invalidate" }');
    expect(hookSource).not.toContain("postgres_changes");
  });

  it("uses one light polling safety net regardless of realtime subscription status", () => {
    const intervalCount = (hookSource.match(/setInterval\(/g) ?? []).length;
    expect(intervalCount).toBe(1);
    expect(hookSource).not.toContain('currentStatus !== "SUBSCRIBED"');
  });
});

describe("useTableOccupancyRealtime hook source contract", () => {
  const hookSource = readFileSync(
    new URL("../src/hooks/use-table-occupancy-realtime.ts", import.meta.url),
    "utf8",
  );

  it("cleans up the subscription on unmount via the effect's return function", () => {
    expect(hookSource).toContain("return () => controller.dispose()");
  });

  it("re-subscribes when restaurantId changes", () => {
    const start = hookSource.indexOf("export function useTableOccupancyRealtime");
    const block = hookSource.slice(start);
    expect(block).toContain("[restaurantId]");
  });

  it("feeds the latest rendered snapshot revision to the controller", () => {
    const start = hookSource.indexOf("export function useTableOccupancyRealtime");
    const block = hookSource.slice(start);
    expect(block).toContain("revisionRef.current = revision");
    expect(block).toContain("getCurrentRevision: () => revisionRef.current");
  });
});
