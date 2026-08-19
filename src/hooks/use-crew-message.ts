import { useCallback, useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "../lib/supabase-browser";
import { getAnonymousUserId } from "./use-remote-crew";
import {
  CREW_MESSAGE_AUTO_CLOSE_MS,
  isDuplicateCrewMessage,
  markDeliveredCrewMessage,
  pruneDeliveredCrewMessages,
  type CrewMessage,
} from "../lib/crew-message-domain";

type CrewMessageRow = CrewMessage;

export type CrewMessageState = {
  message: string | null;
  dismiss: () => void;
};

export function useCrewMessage(enabled: boolean): CrewMessageState {
  const [message, setMessage] = useState<string | null>(null);
  const deliveredRef = useRef<Map<string, number>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setMessage(null), CREW_MESSAGE_AUTO_CLOSE_MS);
  }, [clearTimer]);

  const dismiss = useCallback(() => {
    clearTimer();
    setMessage(null);
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled) return;
    const client = getSupabaseBrowserClient();
    if (!client) return;

    let mounted = true;
    let channel: ReturnType<typeof client.channel> | null = null;

    const deliver = async () => {
      try {
        const userId = await getAnonymousUserId(client);
        if (!mounted) return;
        channel = client
          .channel(`crew-messages:${userId}`)
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "crew_messages",
              filter: `target_session_id=eq.${userId}`,
            },
            ({ new: row }) => {
              if (!mounted) return;
              const msg = row as CrewMessageRow;
              const now = Date.now();
              pruneDeliveredCrewMessages(deliveredRef.current, now);
              if (isDuplicateCrewMessage(msg.id, deliveredRef.current, now)) return;
              markDeliveredCrewMessage(msg.id, deliveredRef.current, now);
              if (document.visibilityState !== "visible") return;
              setMessage(msg.message);
              scheduleClose();
            },
          )
          .subscribe();
      } catch {
        // crew not authed yet — silently tidak subscribe
      }
    };

    void deliver();

    return () => {
      mounted = false;
      clearTimer();
      if (channel) void client.removeChannel(channel);
    };
  }, [enabled, clearTimer, scheduleClose]);
  return { message, dismiss };
}
