import { useCallback, useEffect, useState } from "react";
import { getPendingInstructions } from "@/lib/crew-instructions.server";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PendingInstruction } from "@/lib/instruction-domain";

type BroadcastCh = {
  on: (type: string, filter: { event: string }, cb: (msg: unknown) => void) => BroadcastCh;
  subscribe: (cb: (status: string) => void) => BroadcastCh;
};

type ClientWithChannel = {
  channel: (name: string, opts: { config: { private: true } }) => BroadcastCh;
  removeChannel: (ch: BroadcastCh) => void;
};

export function usePendingInstructions(
  roleSessionToken: string,
  accessToken: string,
  restaurantId: string,
  roleSessionId: string,
) {
  const [pending, setPending] = useState<PendingInstruction[]>([]);

  const fetchPending = useCallback(async () => {
    if (!roleSessionToken || !accessToken) return;
    try {
      const client = getSupabaseBrowserClient();
      const token = await getLiveAccessToken(client, accessToken);
      const result = await getPendingInstructions({
        data: { roleSessionToken, accessToken: token },
      });
      if (result.ok) setPending(result.instructions);
    } catch {
      // Best-effort instruction fetch
    }
  }, [roleSessionToken, accessToken]);

  // Fetch whenever credentials become available (after client-side hydration)
  useEffect(() => {
    if (!roleSessionToken || !accessToken) return;
    void fetchPending();
  }, [roleSessionToken, accessToken, fetchPending]);

  // Realtime subscription via the primary restaurant broadcast channel
  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !restaurantId || !accessToken) return;

    let channel: BroadcastCh | null = null;
    let cancelled = false;

    void (async () => {
      const liveToken = await getLiveAccessToken(client, accessToken);
      if (cancelled) return;
      if (liveToken) client.realtime.setAuth(liveToken);

      const typed = client as unknown as ClientWithChannel;
      const channelName = `table-occupancy:${restaurantId}`;
      channel = typed.channel(channelName, {
        config: { private: true },
      });

      channel
        .on("broadcast", { event: "instruction" }, (msg: unknown) => {
          const payload = (msg as { payload?: Record<string, unknown> })?.payload;
          if (!payload) return;
          const targetId = payload.target_session_id as string | null;
          if (targetId && targetId !== roleSessionId) return;
          void fetchPending();
        })
        .subscribe(() => {});
    })();

    return () => {
      cancelled = true;
      if (channel) {
        const typed = client as unknown as ClientWithChannel;
        typed.removeChannel(channel);
      }
    };
  }, [restaurantId, accessToken, roleSessionId, fetchPending]);

  // Safety net: periodic background poll + visibility change
  useEffect(() => {
    if (!roleSessionToken || !accessToken) return;

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void fetchPending();
      }
    }, 12_000);

    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void fetchPending();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [roleSessionToken, accessToken, fetchPending]);

  const dismiss = useCallback((instructionId: string) => {
    setPending((prev) => prev.filter((p) => p.instructionId !== instructionId));
  }, []);

  return { pending, dismiss, refetch: fetchPending };
}
