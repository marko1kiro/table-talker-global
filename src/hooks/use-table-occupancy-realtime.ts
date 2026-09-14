// Shared role-UI infrastructure for Kasir/Satgas/Clear Up occupancy views.
// Realtime is an invalidation hint only: snapshots remain authorized by the
// role-session RPC. Status is the real channel callback -- never fabricated.
// Visible pages poll at the idle refresh cadence while healthy (subscribed and
// online) and fall back to the fast poll otherwise; the retry ladder re-opens
// the session after channel errors and on every online transition.
import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "../lib/browser-auth";
import { parseOccupancyBroadcast, type OccupancyBroadcast } from "../lib/occupancy-notice";

export type TableOccupancyRealtimeStatus =
  | "SUBSCRIBING"
  | "SUBSCRIBED"
  | "TIMED_OUT"
  | "CHANNEL_ERROR"
  | "CLOSED";

export const REFETCH_RATE_LIMIT_MS = 1_000;
export const POLL_FALLBACK_MS = 12_000;
export const IDLE_REFRESH_MS = 120_000;
export const RETRY_BASE_MS = 1_000;
export const RETRY_CAP_MS = 60_000;

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

export type NetworkSource = {
  isOnline: () => boolean;
  subscribe: (callback: () => void) => () => void;
};

const ALWAYS_ONLINE: NetworkSource = {
  isOnline: () => true,
  subscribe: () => () => undefined,
};

function browserNetworkSource(): NetworkSource {
  if (typeof window === "undefined") return ALWAYS_ONLINE;
  return {
    isOnline: () => window.navigator.onLine,
    subscribe: (callback) => {
      window.addEventListener("online", callback);
      window.addEventListener("offline", callback);
      return () => {
        window.removeEventListener("online", callback);
        window.removeEventListener("offline", callback);
      };
    },
  };
}

function backoffDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS);
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
  net = ALWAYS_ONLINE,
  selfRoleSessionId = null,
  onNotice,
  bindRpc = "bind_role_session_realtime",
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
  net?: NetworkSource;
  selfRoleSessionId?: string | null;
  onNotice?: (broadcast: OccupancyBroadcast) => void;
  bindRpc?: string;
}): TableOccupancyRealtimeController {
  let lastRefetchAt = -Infinity;
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let pollPeriodMs: number | null = null;
  let channel: BroadcastChannelLike | null = null;
  let disposed = false;
  let currentStatus: TableOccupancyRealtimeStatus | null = null;
  let online = net.isOnline();
  let retryAttempt = 0;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let startSession: () => void = () => undefined;

  const rateLimitedRefetch = () => {
    if (disposed) return;
    const current = now();
    if (current - lastRefetchAt < REFETCH_RATE_LIMIT_MS) return;
    lastRefetchAt = current;
    refetch();
  };

  const clearRetryTimer = () => {
    if (retryHandle !== null) {
      clearTimeout(retryHandle);
      retryHandle = null;
    }
  };

  const scheduleRetry = () => {
    if (disposed || !online || retryHandle !== null) return;
    const delay = backoffDelayMs(retryAttempt);
    retryAttempt += 1;
    retryHandle = setTimeout(() => {
      retryHandle = null;
      if (disposed) return;
      startSession();
    }, delay);
  };

  const healthy = () => online && currentStatus === "SUBSCRIBED";

  const startPolling = () => {
    if (pollHandle || disposed || !visibility.isVisible()) return;
    const period = healthy() ? IDLE_REFRESH_MS : POLL_FALLBACK_MS;
    pollPeriodMs = period;
    pollHandle = setIntervalFn(() => {
      if (!disposed && visibility.isVisible()) refetch();
    }, period);
  };

  const stopPolling = () => {
    if (!pollHandle) return;
    clearIntervalFn(pollHandle);
    pollHandle = null;
    pollPeriodMs = null;
  };

  const syncPolling = () => {
    if (pollHandle && pollPeriodMs !== (healthy() ? IDLE_REFRESH_MS : POLL_FALLBACK_MS)) {
      stopPolling();
    }
    if (!disposed && visibility.isVisible()) startPolling();
    else stopPolling();
  };

  const unsubscribeVisibility = visibility.subscribe(syncPolling);

  const unsubscribeNet = net.subscribe(() => {
    const nextOnline = net.isOnline();
    if (nextOnline && !online) {
      retryAttempt = 0;
      clearRetryTimer();
      startSession();
    }
    online = nextOnline;
    if (!online) clearRetryTimer();
    syncPolling();
  });

  const handleStatus = (status: string) => {
    if (disposed) return;
    currentStatus = status as TableOccupancyRealtimeStatus;
    if (currentStatus === "SUBSCRIBED") {
      retryAttempt = 0;
      clearRetryTimer();
    } else if (
      currentStatus === "CHANNEL_ERROR" ||
      currentStatus === "TIMED_OUT" ||
      currentStatus === "CLOSED"
    ) {
      scheduleRetry();
    }
    onStatusChange?.(currentStatus);
    syncPolling();
  };

  const handleInvalidate = (message: unknown) => {
    const broadcast = parseOccupancyBroadcast(message);
    if (broadcast && broadcast.actor_role_session_id !== selfRoleSessionId) {
      onNotice?.(broadcast);
    }
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
    if (channel) client.removeChannel(channel);
    channel = client
      .channel(tableOccupancyChannelName(restaurantId), { config: { private: true } })
      .on("broadcast", { event: "invalidate" }, handleInvalidate)
      .subscribe(handleStatus);
  };

  if (client && restaurantId && sessionToken) {
    const onRpcResult = ({ data, error }: { data?: unknown; error?: unknown }) => {
      if (disposed) return;
      if (error || data !== true) {
        handleStatus("CHANNEL_ERROR");
        return;
      }
      subscribePrivate();
    };
    const onRpcReject = () => {
      if (!disposed) handleStatus("CHANNEL_ERROR");
    };

    startSession = () => {
      const hasAuth =
        "auth" in client &&
        typeof (client as unknown as { auth?: { getSession?: () => Promise<unknown> } }).auth
          ?.getSession === "function";

      const bindAfterAuth = () =>
        client
          .rpc(bindRpc, {
            p_restaurant_id: restaurantId,
            p_session_token: sessionToken,
          })
          .then(onRpcResult, onRpcReject);

      if (hasAuth) {
        void (client as unknown as { auth: { getSession: () => Promise<unknown> } }).auth
          .getSession()
          .then(
            () => {
              // Force-supply the JWT to the Realtime client so the channel join
              // payload carries the access_token. Without this, the async
              // setAuth inside connect() races against the join message.
              const rt = (client as unknown as { realtime?: { setAuth?: () => Promise<void> } })
                .realtime;
              if (rt?.setAuth) {
                return rt.setAuth().then(bindAfterAuth, bindAfterAuth);
              }
              return bindAfterAuth();
            },
            () => bindAfterAuth(),
          );
      } else {
        void bindAfterAuth();
      }
    };
    startSession();
  } else {
    handleStatus("CHANNEL_ERROR");
  }
  syncPolling();

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      clearRetryTimer();
      unsubscribeNet();
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
  selfRoleSessionId?: string | null,
  onNotice?: (broadcast: OccupancyBroadcast) => void,
  bindRpc?: string,
) {
  const [status, setStatus] = useState<TableOccupancyRealtimeStatus>("SUBSCRIBING");
  const refetchRef = useRef(refetch);
  const revisionRef = useRef(revision);
  const onNoticeRef = useRef(onNotice);
  const selfRoleSessionIdRef = useRef(selfRoleSessionId);
  const bindRpcRef = useRef(bindRpc);
  refetchRef.current = refetch;
  revisionRef.current = revision;
  onNoticeRef.current = onNotice;
  selfRoleSessionIdRef.current = selfRoleSessionId;
  bindRpcRef.current = bindRpc;

  useEffect(() => {
    if (!restaurantId || !sessionToken) return;
    setStatus("SUBSCRIBING");

    const client = getSupabaseBrowserClient() as unknown as SupabaseClientLike | null;
    const controller = createTableOccupancyRealtimeController({
      client,
      restaurantId,
      sessionToken,
      refetch: () => refetchRef.current(),
      getCurrentRevision: () => revisionRef.current,
      onStatusChange: setStatus,
      visibility: browserVisibilitySource(),
      net: browserNetworkSource(),
      selfRoleSessionId: selfRoleSessionIdRef.current ?? null,
      onNotice: (broadcast) => onNoticeRef.current?.(broadcast),
      bindRpc: bindRpcRef.current,
    });

    return () => {
      controller.dispose();
    };
  }, [restaurantId, sessionToken]);

  return status;
}
