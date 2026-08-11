import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boundedFailureReason,
  commandIsProcessable,
  HEARTBEAT_MS,
  type AudioId,
  type RemoteCommand,
} from "../lib/remote-audio-domain";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

export type CrewRegistration = {
  displayName: string;
  normalizedName: string;
  audioReady: boolean;
};

type ProcessorOptions = {
  sessionId: string;
  playRemoteAudio: (audioId: AudioId) => Promise<void>;
  acknowledge: (
    commandId: string,
    status: "played" | "failed",
    reason: string | null,
  ) => Promise<void>;
  now: () => number;
  onNeedsAudioRecovery?: () => void;
  onDeliveryUncertain?: () => void;
};

type RemoteCommandRow = {
  id: string;
  target_session_id: string;
  audio_id: string;
  created_at: string;
  expires_at: string;
};

function toRemoteCommand(row: RemoteCommandRow): RemoteCommand {
  return {
    id: row.id,
    targetSessionId: row.target_session_id,
    audioId: row.audio_id as AudioId,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function createRemoteCommandProcessor({
  sessionId,
  playRemoteAudio,
  acknowledge,
  now,
  onNeedsAudioRecovery,
  onDeliveryUncertain,
}: ProcessorOptions) {
  const processedIds = new Set<string>();
  let newestCreatedAt: string | null = null;

  return {
    async process(command: RemoteCommand) {
      if (!commandIsProcessable(command, sessionId, processedIds, newestCreatedAt, now())) return;
      processedIds.add(command.id);
      newestCreatedAt = command.createdAt;
      try {
        await playRemoteAudio(command.audioId);
      } catch (error) {
        onNeedsAudioRecovery?.();
        try {
          await acknowledge(command.id, "failed", boundedFailureReason(error));
        } catch {
          onDeliveryUncertain?.();
        }
        return;
      }
      try {
        await acknowledge(command.id, "played", null);
      } catch {
        onDeliveryUncertain?.();
      }
    },
  };
}

function deviceDescription() {
  return navigator.userAgent.slice(0, 200) || "Unknown browser";
}

export function useRemoteCrew({
  registration,
  playRemoteAudio,
}: {
  registration: CrewRegistration | null;
  playRemoteAudio: (audioId: AudioId) => Promise<void>;
}) {
  const [offline, setOffline] = useState(false);
  const [duplicateName, setDuplicateName] = useState(false);
  const [needsAudioRecovery, setNeedsAudioRecovery] = useState(false);
  const [deliveryUncertain, setDeliveryUncertain] = useState(false);
  const playRef = useRef(playRemoteAudio);
  playRef.current = playRemoteAudio;

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!registration) {
      setOffline(false);
      return;
    }
    if (!client) {
      setOffline(true);
      return;
    }

    let active = true;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let userId: string | null = null;
    const update = (setter: (value: boolean) => void, value: boolean) => {
      if (active) setter(value);
    };
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { error } = await client.rpc(fn, args);
      if (error) throw error;
    };
    const heartbeat = async (connectionState: "connected" | "disconnected") => {
      if (!userId) return;
      await rpc("heartbeat_crew_session", {
        p_audio_ready: registration.audioReady,
        p_visibility_state: document.visibilityState,
        p_connection_state: connectionState,
      });
    };
    const disconnect = () => void heartbeat("disconnected").catch(() => undefined);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible")
        void heartbeat("connected").catch(() => update(setOffline, true));
      else disconnect();
    };

    const start = async () => {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) {
        update(setOffline, true);
        return;
      }
      userId = data.user.id;
      if (!active) return;
      const { error: claimError } = await client.rpc("claim_crew_session", {
        p_display_name: registration.displayName,
        p_normalized_name: registration.normalizedName,
        p_device_description: deviceDescription(),
        p_audio_ready: registration.audioReady,
        p_visibility_state: document.visibilityState,
      });
      if (!active) return;
      if (claimError) {
        update(setDuplicateName, /duplicate|unique/i.test(claimError.message));
        update(setOffline, !/duplicate|unique/i.test(claimError.message));
        return;
      }
      update(setOffline, false);
      const processor = createRemoteCommandProcessor({
        sessionId: userId,
        playRemoteAudio: (audioId) => playRef.current(audioId),
        acknowledge: async (commandId, status, reason) => {
          try {
            await rpc("ack_remote_command", {
              p_command_id: commandId,
              p_status: status,
              p_failure_reason: reason,
            });
          } catch {
            throw new Error("ACK_FAILED");
          }
        },
        now: Date.now,
        onNeedsAudioRecovery: () => update(setNeedsAudioRecovery, true),
        onDeliveryUncertain: () => update(setDeliveryUncertain, true),
      });
      channel = client
        .channel(`remote-commands:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "remote_commands",
            filter: `target_session_id=eq.${userId}`,
          },
          ({ new: row }) => void processor.process(toRemoteCommand(row as RemoteCommandRow)),
        )
        .subscribe((status) => update(setOffline, status !== "SUBSCRIBED"));
      if (document.visibilityState === "visible")
        void heartbeat("connected").catch(() => update(setOffline, true));
      timer = setInterval(() => {
        if (document.visibilityState === "visible")
          void heartbeat("connected").catch(() => update(setOffline, true));
      }, HEARTBEAT_MS);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", disconnect);
    };

    void start();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", disconnect);
      if (timer) clearInterval(timer);
      disconnect();
      if (channel) void client.removeChannel(channel);
    };
  }, [registration]);

  return {
    offline,
    duplicateName,
    needsAudioRecovery,
    deliveryUncertain,
    retryAudioUnlock: () => setNeedsAudioRecovery(false),
  };
}
