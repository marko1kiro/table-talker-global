// Task 9: shared role-UI infrastructure. Realtime invalidation for the
// table occupancy grid/list views (Kasir/Satgas/Clear Up/Manager).
//
// Modeled on the *shape* of the deleted crew-remote-relay hook module’s
// channel-subscribe/cleanup lifecycle (see git history at ee77d6b) and on
// the live `owner-dashboard` Supabase Realtime Broadcast pattern in
// src/routes/super-admin/index.tsx -- but deliberately stripped of every
// presence/connection-keep-alive piece that the older module had. There
// is no session-claiming RPC call anywhere in this module and no custom
// reconnect loop. The *only* outbound side effect this module ever
// performs is calling the caller-provided `refetch` callback -- on a
// broadcast `invalidate` event (rate-limited to at most once/sec) or, while
// the channel is not subscribed and the page is visible, on a plain
// interval-polling fallback (10-15s). This is a permanent architectural
// invariant for this codebase: any future change to this file must keep
// it free of the removed keep-alive pattern (enforced by a source-scan
// test suite alongside the behavioral tests for this module).
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

export type TableOccupancyRealtimeStatus =
  | "SUBSCRIBING"
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CHANNEL_ERROR"
  | "CLOSED";

export const REFETCH_RATE_LIMIT_MS = 1_000;
export const POLL_FALLBACK_MS = 12_000; // within the spec's 10-15s range

type BroadcastChannelLike = {
  on: (
    type: "broadcast",
    filter: { event: string },
    callback: (payload: unknown) => void,
  ) => BroadcastChannelLike;
  subscribe: (callback: (status: string) => void) => BroadcastChannelLike;
};

type SupabaseClientLike = {
  channel: (name: string) => BroadcastChannelLike;
  removeChannel: (channel: BroadcastChannelLike) => void;
};

export type VisibilitySource = {
  isVisible: () => boolean;
  subscribe: (callback: () => void) => () => void;
};

const ALWAYS_VISIBLE: VisibilitySource = {
  isVisible: () => true,
  subscribe: () => () => undefined,
};

function browserVisibilitySource(): VisibilitySource {
  if (typeof document === "undefined") return ALWAYS_VISIBLE;
  return {
    isVisible: () => document.visibilityState === "visible",
    subscribe: (callback) => {
      document.addEventListener("visibilitychange", callback);
      return () => document.removeEventListener("visibilitychange", callback);
    },
  };
}

export function tableOccupancyChannelName(restaurantId: string): string {
  return `table-occupancy:${restaurantId}`;
}

export type TableOccupancyRealtimeController = {
  dispose: () => void;
};

// Pure(-ish), dependency-injected core: given a Supabase-client-like
// object (or null) and a refetch callback, subscribes to the per-
// restaurant broadcast channel and manages the rate limit + visible-only
// polling fallback. Kept separate from the React hook below so it can be
// unit-tested directly without a browser environment.
export function createTableOccupancyRealtimeController({
  client,
  restaurantId,
  refetch,
  onStatusChange,
  now = () => Date.now(),
  setIntervalFn = (handler: () => void, ms: number) => setInterval(handler, ms),
  clearIntervalFn = (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
  visibility = ALWAYS_VISIBLE,
}: {
  client: SupabaseClientLike | null;
  restaurantId: string;
  refetch: () => void;
  onStatusChange?: (status: TableOccupancyRealtimeStatus) => void;
  now?: () => number;
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  visibility?: VisibilitySource;
}): TableOccupancyRealtimeController {
  let lastRefetchAt = -Infinity;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let channel: BroadcastChannelLike | null = null;
  let currentStatus: TableOccupancyRealtimeStatus = "SUBSCRIBING";
  let disposed = false;

  const rateLimitedRefetch = () => {
    if (disposed) return;
    const current = now();
    if (current - lastRefetchAt < REFETCH_RATE_LIMIT_MS) return;
    lastRefetchAt = current;
    refetch();
  };

  const startPolling = () => {
    if (pollHandle || disposed) return;
    pollHandle = setIntervalFn(() => {
      if (!disposed && visibility.isVisible()) refetch();
    }, POLL_FALLBACK_MS);
  };

  const stopPolling = () => {
    if (!pollHandle) return;
    clearIntervalFn(pollHandle);
    pollHandle = null;
  };

  const syncPolling = () => {
    if (!disposed && currentStatus !== "SUBSCRIBED" && visibility.isVisible()) {
      startPolling();
    } else {
      stopPolling();
    }
  };

  const unsubscribeVisibility = visibility.subscribe(syncPolling);

  const handleStatus = (status: string) => {
    if (disposed) return;
    currentStatus = status as TableOccupancyRealtimeStatus;
    onStatusChange?.(currentStatus);
    syncPolling();
  };

  if (client) {
    channel = client
      .channel(tableOccupancyChannelName(restaurantId))
      .on("broadcast", { event: "invalidate" }, () => rateLimitedRefetch())
      .subscribe(handleStatus);
    // Protect against a stalled subscribe attempt that never emits a status.
    syncPolling();
  } else {
    // No client available (e.g. missing env vars) -- fall back to polling
    // immediately rather than never refreshing at all.
    handleStatus("CHANNEL_ERROR");
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeVisibility();
      stopPolling();
      if (channel && client) client.removeChannel(channel);
    },
  };
}

export function useTableOccupancyRealtime(restaurantId: string, refetch: () => void) {
  const [status, setStatus] = useState<TableOccupancyRealtimeStatus>("SUBSCRIBING");
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    // The real SupabaseClient's channel/removeChannel signatures are far
    // richer than the minimal SupabaseClientLike shape this module
    // actually uses, so narrow it down to just what's needed here.
    const client = getSupabaseBrowserClient() as unknown as SupabaseClientLike | null;
    const controller = createTableOccupancyRealtimeController({
      client,
      restaurantId,
      refetch: () => refetchRef.current(),
      onStatusChange: setStatus,
      visibility: browserVisibilitySource(),
    });
    return () => controller.dispose();
  }, [restaurantId]);

  return status;
}
