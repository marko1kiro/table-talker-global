import { useCallback, useEffect, useRef, useState } from "react";
import { getPendingInstructions } from "@/lib/crew-instructions.server";
import { getLiveAccessToken, getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PendingInstruction } from "@/lib/instruction-domain";

export function usePendingInstructions(
  roleSessionToken: string,
  accessToken: string,
  restaurantId: string,
  roleSessionId: string,
) {
  const [pending, setPending] = useState<PendingInstruction[]>([]);
  const fetchedRef = useRef(false);

  const fetchPending = useCallback(async () => {
    if (!roleSessionToken || !accessToken) return;
    const client = getSupabaseBrowserClient();
    const token = await getLiveAccessToken(client, accessToken);
    const result = await getPendingInstructions({
      data: { roleSessionToken, accessToken: token },
    });
    if (result.ok) setPending(result.instructions);
  }, [roleSessionToken, accessToken]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void fetchPending();
  }, [fetchPending]);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client || !restaurantId) return;
    const channelName = `instruction-listen:${restaurantId}`;
    const channel = (
      client as unknown as {
        channel: (
          name: string,
          opts: { config: { private: true } },
        ) => {
          on: (type: string, filter: { event: string }, cb: (msg: unknown) => void) => unknown;
          subscribe: (cb: (status: string) => void) => unknown;
        };
      }
    ).channel(channelName, { config: { private: true } });

    channel
      .on("broadcast", { event: "instruction" }, (msg: unknown) => {
        const payload = (msg as { payload?: Record<string, unknown> })?.payload;
        if (!payload) return;
        const targetId = payload.target_session_id as string | null;
        if (targetId && targetId !== roleSessionId) return;
        void fetchPending();
      })
      .subscribe(() => {});

    return () => {
      (client as unknown as { removeChannel: (ch: unknown) => void }).removeChannel(channel);
    };
  }, [restaurantId, roleSessionId, fetchPending]);

  const dismiss = useCallback((instructionId: string) => {
    setPending((prev) => prev.filter((p) => p.instructionId !== instructionId));
  }, []);

  return { pending, dismiss, refetch: fetchPending };
}
