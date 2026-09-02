// Shared role-UI infrastructure for Kasir/Satgas/Clear Up occupancy views.
// Realtime is an invalidation hint only: snapshots remain authorized by the
// role-session RPC, and visible pages keep the 12-second polling safety net.
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

export type TableOccupancyRealtimeStatus =
  | "SUBSCRIBING"
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CHANNEL_ERROR"
  | "CLOSED";

export const REFETCH_RATE_LIMIT_MS = 1_000;
export const POLL_FALLBACK_MS = 12_000;

type BroadcastChannelLike = {
  on: (
    type: "broadcast",
    filter: { event: string },
    callback: (payload: unknown) => void,
  ) => BroadcastChannelLike;
  subscribe: (callback: (status: string) => void) => BroadcastChannelLike;
};

type SupabaseClientLike = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  channel: (name: string, options: { config: { private: true } }) => BroadcastChannelLike;
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

// Binds the bearer role session to the caller's Supabase Auth identity before
// opening the private channel. A rejected binding never falls back to a public
// channel; the visible-only polling safety net remains active instead.
export function createTableOccupancyRealtimeController({
  client,
  restaurantId,
  sessionToken,
  refetch,
  getCurrentRevision = () => null,
  onStatusChange,
  now = () => Date.now(),
  setIntervalFn = (handler: () => void, ms: number) => setInterval(handler, ms),
  clearIntervalFn = (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
  visibility = ALWAYS_VISIBLE,
}: {
  client: SupabaseClientLike | null;
  restaurantId: string;
  sessionToken: string;
  refetch: () => void;
  getCurrentRevision?: () => number | null;
  onStatusChange?: (status: TableOccupancyRealtimeStatus) => void;
  now?: () => number;
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
  visibility?: VisibilitySource;
}): TableOccupancyRealtimeController {
  let lastRefetchAt = -Infinity;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let channel: BroadcastChannelLike | null = null;
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
    if (!disposed && visibility.isVisible()) startPolling();
    else stopPolling();
  };

  const unsubscribeVisibility = visibility.subscribe(syncPolling);

  const handleStatus = (status: string) => {
    if (disposed) return;
    onStatusChange?.(status as TableOccupancyRealtimeStatus);
  };

  const handleInvalidate = (message: unknown) => {
    if (!message || typeof message !== "object") {
      rateLimitedRefetch();
      return;
    }
    const payload = (message as { payload?: unknown }).payload;
    if (!payload || typeof payload !== "object") {
      rateLimitedRefetch();
      return;
    }
    const revision = (payload as { revision?: unknown }).revision;
    if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
      rateLimitedRefetch();
      return;
    }
    const currentRevision = getCurrentRevision();
    if (currentRevision !== null && revision <= currentRevision) return;
    rateLimitedRefetch();
  };

  const subscribePrivate = () => {
    if (!client || disposed) return;
    channel = client
      .channel(tableOccupancyChannelName(restaurantId), { config: { private: true } })
      .on("broadcast", { event: "invalidate" }, handleInvalidate)
      .subscribe(handleStatus);
  };

  if (client && restaurantId && sessionToken) {
    void client
      .rpc("bind_role_session_realtime", {
        p_restaurant_id: restaurantId,
        p_session_token: sessionToken,
      })
      .then(
        ({ data, error }) => {
          if (disposed) return;
          if (error || data !== true) {
            handleStatus("CHANNEL_ERROR");
            return;
          }
          subscribePrivate();
        },
        () => handleStatus("CHANNEL_ERROR"),
      );
  } else {
    handleStatus("CHANNEL_ERROR");
  }
  syncPolling();

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

export function useTableOccupancyRealtime(
  restaurantId: string,
  sessionToken: string,
  revision: number | null,
  refetch: () => void,
) {
  const [status, setStatus] = useState<TableOccupancyRealtimeStatus>("SUBSCRIBING");
  const refetchRef = useRef(refetch);
  const revisionRef = useRef(revision);
  refetchRef.current = refetch;
  revisionRef.current = revision;

  useEffect(() => {
    const client = getSupabaseBrowserClient() as unknown as SupabaseClientLike | null;
    const controller = createTableOccupancyRealtimeController({
      client,
      restaurantId,
      sessionToken,
      refetch: () => refetchRef.current(),
      getCurrentRevision: () => revisionRef.current,
      onStatusChange: setStatus,
      visibility: browserVisibilitySource(),
    });
    return () => controller.dispose();
  }, [restaurantId, sessionToken]);

  return status;
}
