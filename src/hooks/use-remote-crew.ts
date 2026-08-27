import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  boundedFailureReason,
  commandIsProcessable,
  HEARTBEAT_MS,
  type AudioId,
  type CommandWatermark,
  type RemoteCommand,
} from "../lib/remote-audio-domain";
import { getSupabaseBrowserClient } from "../lib/supabase-browser";

const anonymousUsers = new WeakMap<SupabaseClient, Promise<string>>();
const commandStates = new WeakMap<SupabaseClient, Map<string, RemoteCommandState>>();

export function channelStateIsTerminal(status: string) {
  return status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT";
}

export function canSendConnectedHeartbeat(channelTerminal: boolean, visibilityState: string) {
  return !channelTerminal && visibilityState === "visible";
}

export function canReconnectPresence(visibilityState: string) {
  return visibilityState === "visible";
}

export function shouldActivatePresence(status: string) {
  return status === "SUBSCRIBED";
}

export function isInvalidSessionError(error: unknown) {
  return /\b(?:INVALID_CREW_SESSION|INVALID_TENANT_SESSION|SESSION_NOT_FOUND)\b|Sesi resto tidak valid/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export function updateUncertainCommandIds(ids: Set<string>, commandId: string, uncertain: boolean) {
  if (uncertain) ids.add(commandId);
  else ids.delete(commandId);
  return ids.size > 0;
}

export function canProcessCatchUp(
  active: boolean,
  activeProcessor: unknown,
  processor: unknown,
  channel: unknown,
  nextChannel: unknown,
) {
  return active && activeProcessor === processor && channel === nextChannel;
}

export function deliveryIsUncertain(catchUpUncertain: boolean, uncertainCommandIds: Set<string>) {
  return catchUpUncertain || uncertainCommandIds.size > 0;
}

export function createChannelStatusHandler<T extends object>({
  channel,
  currentChannel,
  activatePresence,
  stopHeartbeat,
  disconnect,
  setOffline,
  setConnectionState,
  removeChannel,
  markTerminal = () => undefined,
}: {
  channel: T;
  currentChannel: () => T | null;
  activatePresence: () => void;
  stopHeartbeat: () => void;
  disconnect: () => void;
  setOffline: (value: boolean) => void;
  setConnectionState: (value: "offline" | "online") => void;
  removeChannel: (channel: T) => void;
  markTerminal?: () => void;
}) {
  return (status: string) => {
    if (currentChannel() !== channel) return;
    if (shouldActivatePresence(status)) {
      setOffline(false);
      activatePresence();
      return;
    }
    if (!channelStateIsTerminal(status)) return;
    markTerminal();
    stopHeartbeat();
    disconnect();
    removeChannel(channel);
    setOffline(true);
    setConnectionState("offline");
  };
}

export function replaceHeartbeatTimer<T>(
  timer: T | null,
  clear: (timer: T) => void,
  start: () => T,
) {
  if (timer !== null) clear(timer);
  return start();
}

export async function getAnonymousUserId(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getUser();
  if (data.user) return data.user.id;
  let pending = anonymousUsers.get(client);
  if (!pending) {
    pending = client.auth
      .signInAnonymously()
      .then(({ data, error }) => {
        if (error || !data.user) throw error ?? new Error("Anonymous sign-in failed");
        return data.user.id;
      })
      .catch((error) => {
        anonymousUsers.delete(client);
        throw error;
      });
    anonymousUsers.set(client, pending);
  }
  return pending;
}

export type CrewRegistration = {
  displayName: string;
  normalizedName: string;
  audioReady: boolean;
  restaurantId: string;
  tenantToken: string;
  crewSessionToken: string;
};

export function crewRegistrationKey(registration: CrewRegistration | null) {
  if (!registration) return "";
  return JSON.stringify([
    registration.displayName,
    registration.normalizedName,
    registration.audioReady,
    registration.restaurantId,
    registration.tenantToken,
  ]);
}

export function crewClaimArgs(
  registration: CrewRegistration,
  deviceDescription: string,
  visibilityState: "visible" | "hidden",
) {
  if (visibilityState !== "visible") return null;
  return {
    p_restaurant_id: registration.restaurantId,
    p_tenant_token: registration.tenantToken,
    p_display_name: registration.displayName,
    p_normalized_name: registration.normalizedName,
    p_device_description: deviceDescription,
    p_audio_ready: registration.audioReady,
    p_visibility_state: visibilityState,
  };
}

export function createVisibleClaimCoordinator({
  ensureAuth,
  isVisible,
  claim,
  subscribe,
}: {
  ensureAuth: () => Promise<string>;
  isVisible: () => boolean;
  claim: (userId: string) => Promise<boolean>;
  subscribe: (userId: string) => void;
}) {
  let userId: string | null = null;
  let authInFlight: Promise<void> | null = null;
  let claimInFlight: Promise<void> | null = null;
  let subscribed = false;

  const claimWhenVisible = async () => {
    if (!userId || !isVisible() || subscribed) return;
    if (!claimInFlight)
      claimInFlight = claim(userId)
        .then((claimed) => {
          if (claimed && !subscribed) {
            subscribed = true;
            subscribe(userId!);
          }
        })
        .finally(() => {
          claimInFlight = null;
        });
    return claimInFlight;
  };

  return {
    start: () => {
      if (!authInFlight)
        authInFlight = ensureAuth().then((id) => {
          userId = id;
        });
      return authInFlight.then(claimWhenVisible);
    },
    claimWhenVisible,
  };
}

const PROCESSED_COMMAND_MAX_AGE_MS = 35_000;
const PROCESSED_COMMAND_MAX_COUNT = 256;

type ProcessedCommand = { expiresAt: number; processedAt: number };

export type RemoteCommandState = {
  processedIds: Map<string, ProcessedCommand>;
  newest: CommandWatermark | null;
  queue: Promise<void>;
};

export function pruneProcessedCommands(processedIds: Map<string, ProcessedCommand>, now: number) {
  for (const [id, command] of processedIds)
    if (command.expiresAt <= now - PROCESSED_COMMAND_MAX_AGE_MS) processedIds.delete(id);
  if (processedIds.size <= PROCESSED_COMMAND_MAX_COUNT) return;
  for (const [id] of [...processedIds].sort(([, a], [, b]) => a.processedAt - b.processedAt)) {
    processedIds.delete(id);
    if (processedIds.size <= PROCESSED_COMMAND_MAX_COUNT) return;
  }
}

export function getRemoteCommandState(
  client: SupabaseClient,
  sessionId: string,
): RemoteCommandState {
  let sessions = commandStates.get(client);
  if (!sessions) {
    sessions = new Map();
    commandStates.set(client, sessions);
  }
  let state = sessions.get(sessionId);
  if (!state) {
    state = { processedIds: new Map(), newest: null, queue: Promise.resolve() };
    sessions.set(sessionId, state);
  }
  return state;
}

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
  onPending?: (commandId: string, uncertain: boolean) => void;
  onSessionInvalid?: () => void;
  isInvalidSessionError?: (error: unknown) => boolean;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  isVisible?: () => boolean;
  state?: RemoteCommandState;
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
  onPending,
  onSessionInvalid,
  isInvalidSessionError: isInvalidAcknowledgementError = () => false,
  schedule = setTimeout,
  cancel = clearTimeout,
  isVisible = () => typeof document === "undefined" || document.visibilityState === "visible",
  state = { processedIds: new Map(), newest: null, queue: Promise.resolve() },
}: ProcessorOptions) {
  const pendingAcks = new Map<
    string,
    {
      status: "played" | "failed";
      reason: string | null;
      expiresAt: number;
      attempt: number;
      timer: ReturnType<typeof setTimeout> | null;
      inFlight: Promise<void> | null;
    }
  >();
  const retryDelays = [250, 500, 1_000];
  let disposed = false;
  const removePendingAck = (commandId: string, delivered = false) => {
    const pending = pendingAcks.get(commandId);
    if (!pending) return;
    if (pending.timer !== null) cancel(pending.timer);
    pendingAcks.delete(commandId);
    if (delivered) onPending?.(commandId, false);
  };
  const dispose = () => {
    disposed = true;
    for (const commandId of [...pendingAcks.keys()]) removePendingAck(commandId);
  };
  const acknowledgePending = (commandId: string): Promise<void> => {
    const pending = pendingAcks.get(commandId);
    if (!pending || disposed) return Promise.resolve();
    if (now() >= pending.expiresAt) {
      removePendingAck(commandId);
      onPending?.(commandId, true);
      return Promise.resolve();
    }
    if (pending.inFlight) return pending.inFlight;
    pending.inFlight = acknowledge(commandId, pending.status, pending.reason)
      .then(() => {
        if (disposed || pendingAcks.get(commandId) !== pending) return;
        removePendingAck(commandId, true);
      })
      .catch((error) => {
        if (disposed || pendingAcks.get(commandId) !== pending) return;
        pending.inFlight = null;
        if (isInvalidAcknowledgementError(error)) {
          dispose();
          onSessionInvalid?.();
          return;
        }
        onPending?.(commandId, true);
        const delay = retryDelays[pending.attempt++];
        if (delay === undefined) return;
        const remaining = pending.expiresAt - now();
        if (remaining <= 0) {
          removePendingAck(commandId);
          onPending?.(commandId, true);
          return;
        }
        const timer = schedule(
          () => {
            if (disposed || pendingAcks.get(commandId) !== pending) return;
            pending.timer = null;
            void acknowledgePending(commandId);
          },
          Math.min(delay, remaining),
        );
        if (disposed || pendingAcks.get(commandId) !== pending) cancel(timer);
        else pending.timer = timer;
      });
    return pending.inFlight;
  };
  const enqueueAcknowledgement = (
    commandId: string,
    status: "played" | "failed",
    reason: string | null,
    expiresAt: number,
  ) => {
    if (!pendingAcks.has(commandId))
      pendingAcks.set(commandId, {
        status,
        reason,
        expiresAt,
        attempt: 0,
        timer: null,
        inFlight: null,
      });
    return acknowledgePending(commandId);
  };
  const process = async (command: RemoteCommand) => {
    if (disposed) return;
    if (state.newest?.createdAt !== command.createdAt || state.newest.id !== command.id) return;
    if (
      !commandIsProcessable(
        command,
        sessionId,
        new Set([...state.processedIds.keys()].filter((id) => id !== command.id)),
        null,
        now(),
      )
    )
      return;
    if (!isVisible()) return;
    try {
      await playRemoteAudio(command.audioId);
    } catch (error) {
      if (disposed) return;
      onNeedsAudioRecovery?.();
      await enqueueAcknowledgement(
        command.id,
        "failed",
        boundedFailureReason(error),
        Date.parse(command.expiresAt),
      );
      return;
    }
    if (disposed) return;
    await enqueueAcknowledgement(command.id, "played", null, Date.parse(command.expiresAt));
  };

  return {
    process(command: RemoteCommand) {
      if (disposed) return state.queue;
      const currentTime = now();
      pruneProcessedCommands(state.processedIds, currentTime);
      if (
        !commandIsProcessable(
          command,
          sessionId,
          new Set(state.processedIds.keys()),
          state.newest,
          currentTime,
        )
      )
        return state.queue;
      state.processedIds.set(command.id, {
        expiresAt: Date.parse(command.expiresAt),
        processedAt: currentTime,
      });
      pruneProcessedCommands(state.processedIds, currentTime);
      state.newest = { createdAt: command.createdAt, id: command.id };
      state.queue = state.queue.then(() => process(command));
      return state.queue;
    },
    dispose,
  };
}

function deviceDescription() {
  return navigator.userAgent.slice(0, 200) || "Unknown browser";
}

export function useRemoteCrew({
  registration,
  playRemoteAudio,
  onCrewSessionId,
  onSessionInvalid,
}: {
  registration: CrewRegistration | null;
  playRemoteAudio: (audioId: AudioId) => Promise<void>;
  onCrewSessionId?: (crewSessionId: string, crewSessionToken: string) => void;
  onSessionInvalid?: () => void;
}) {
  const [offline, setOffline] = useState(false);
  const [connectionState, setConnectionState] = useState<"offline" | "connecting" | "online">(
    "offline",
  );
  const [duplicateName, setDuplicateName] = useState(false);
  const [needsAudioRecovery, setNeedsAudioRecovery] = useState(false);
  const [deliveryUncertain, setDeliveryUncertain] = useState(false);
  const uncertainCommandIds = useRef(new Set<string>());
  const catchUpUncertain = useRef(false);
  const playRef = useRef(playRemoteAudio);
  playRef.current = playRemoteAudio;
  const registrationRef = useRef(registration);
  registrationRef.current = registration;
  const registrationKey = crewRegistrationKey(registration);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    const registration = registrationRef.current;
    if (!registration) {
      setOffline(false);
      setConnectionState("offline");
      return;
    }
    if (!client) {
      setOffline(true);
      setConnectionState("offline");
      return;
    }

    let active = true;
    let channel: ReturnType<SupabaseClient["channel"]> | null = null;
    let activeProcessor: ReturnType<typeof createRemoteCommandProcessor> | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let userId: string | null = null;
    let crewSessionToken = registration.crewSessionToken;
    let channelTerminal = false;
    let presenceActive = false;
    let authInFlight: Promise<string> | null = null;
    let claimInFlight: Promise<void> | null = null;
    const update = (setter: (value: boolean) => void, value: boolean) => {
      if (active) setter(value);
    };
    const resetDeliveryUncertainty = () => {
      uncertainCommandIds.current.clear();
      catchUpUncertain.current = false;
      update(setDeliveryUncertain, false);
    };
    const updatePending = (commandId: string, uncertain: boolean) => {
      updateUncertainCommandIds(uncertainCommandIds.current, commandId, uncertain);
      update(
        setDeliveryUncertain,
        deliveryIsUncertain(catchUpUncertain.current, uncertainCommandIds.current),
      );
    };
    resetDeliveryUncertainty();
    update(setDuplicateName, false);
    const stopHeartbeat = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const invalidateSession = () => {
      stopHeartbeat();
      activeProcessor?.dispose();
      activeProcessor = null;
      resetDeliveryUncertainty();
      if (channel) void client.removeChannel(channel);
      channel = null;
      channelTerminal = true;
      presenceActive = false;
      onSessionInvalid?.();
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
        p_session_token: crewSessionToken,
      });
    };
    const disconnect = () => void heartbeat("disconnected").catch(() => undefined);
    const activatePresence = () => {
      if (channelTerminal) return;
      presenceActive = true;
      if (canSendConnectedHeartbeat(channelTerminal, document.visibilityState))
        void heartbeat("connected").catch((error) => {
          if (isInvalidSessionError(error)) invalidateSession();
          else update(setOffline, true);
        });
      timer = replaceHeartbeatTimer(timer, clearInterval, () =>
        setInterval(() => {
          if (
            presenceActive &&
            canSendConnectedHeartbeat(channelTerminal, document.visibilityState)
          )
            void heartbeat("connected").catch((error) => {
              if (isInvalidSessionError(error)) invalidateSession();
              else update(setOffline, true);
            });
        }, HEARTBEAT_MS),
      );
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        activeProcessor?.dispose();
        activeProcessor = null;
        if (channel) void client.removeChannel(channel);
        channel = null;
        channelTerminal = false;
        presenceActive = false;
        if (canReconnectPresence(document.visibilityState)) void claimWhenVisible();
        return;
      }
      if (!channelTerminal) disconnect();
    };

    const ensureAuth = () => {
      if (!authInFlight) authInFlight = getAnonymousUserId(client);
      return authInFlight;
    };
    const claimWhenVisible = async () => {
      if (
        !userId ||
        document.visibilityState !== "visible" ||
        (channel && !channelTerminal) ||
        claimInFlight
      )
        return;
      claimInFlight = (async () => {
        try {
          const { data: claimedSession, error: claimError } = await client.rpc(
            "claim_crew_session",
            crewClaimArgs(registration, deviceDescription(), "visible"),
          );
          if (!active) {
            disconnect();
            return;
          }
          if (claimError) {
            if (isInvalidSessionError(claimError)) {
              invalidateSession();
              return;
            }
            update(setDuplicateName, /duplicate|unique/i.test(claimError.message));
            update(setOffline, !/duplicate|unique/i.test(claimError.message));
            return;
          }
          if (
            typeof claimedSession?.session?.id === "string" &&
            typeof claimedSession?.session_token === "string"
          ) {
            crewSessionToken = claimedSession.session_token;
            onCrewSessionId?.(claimedSession.session.id, claimedSession.session_token);
          }
          update(setDuplicateName, false);
          update(setOffline, true);
          if (active) setConnectionState("connecting");
          activeProcessor?.dispose();
          const processor = createRemoteCommandProcessor({
            sessionId: userId,
            state: getRemoteCommandState(client, userId),
            playRemoteAudio: (audioId) => playRef.current(audioId),
            acknowledge: async (commandId, status, reason) => {
              await rpc("ack_remote_command", {
                p_command_id: commandId,
                p_status: status,
                p_failure_reason: reason,
                p_session_token: crewSessionToken,
              });
            },
            now: Date.now,
            isVisible: () => active && document.visibilityState === "visible",
            onNeedsAudioRecovery: () => update(setNeedsAudioRecovery, true),
            onPending: updatePending,
            isInvalidSessionError,
            onSessionInvalid: invalidateSession,
          });
          activeProcessor = processor;
          const catchUp = async () => {
            const { data, error } = await client.rpc("claim_pending_remote_command", {
              p_session_token: crewSessionToken,
            });
            if (!active) return;
            if (!canProcessCatchUp(active, activeProcessor, processor, channel, nextChannel))
              return;
            if (error) {
              if (isInvalidSessionError(error)) {
                invalidateSession();
                return;
              }
              catchUpUncertain.current = true;
              update(setDeliveryUncertain, true);
              return;
            }
            catchUpUncertain.current = false;
            update(
              setDeliveryUncertain,
              deliveryIsUncertain(catchUpUncertain.current, uncertainCommandIds.current),
            );
            if (data) await processor.process(toRemoteCommand(data as RemoteCommandRow));
          };
          const nextChannel = client.channel(`remote-commands:${userId}`).on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "remote_commands",
              filter: `target_session_id=eq.${userId}`,
            },
            ({ new: row }) => {
              if (!active || channel !== nextChannel) return;
              void processor.process(toRemoteCommand(row as RemoteCommandRow));
            },
          );
          channel = nextChannel;
          nextChannel.subscribe(
            createChannelStatusHandler({
              channel: nextChannel,
              currentChannel: () => channel,
              activatePresence: () => {
                if (!active) return;
                setConnectionState("online");
                void catchUp();
                activatePresence();
              },
              stopHeartbeat,
              disconnect,
              setOffline: (value) => update(setOffline, value),
              setConnectionState: (value) => {
                if (active) setConnectionState(value);
              },
              removeChannel: (current) => {
                activeProcessor?.dispose();
                activeProcessor = null;
                void client.removeChannel(current);
                channel = null;
                presenceActive = false;
              },
              markTerminal: () => {
                channelTerminal = true;
              },
            }),
          );
        } catch (error) {
          if (isInvalidSessionError(error)) invalidateSession();
          update(setOffline, true);
          if (active) setConnectionState("offline");
        } finally {
          claimInFlight = null;
        }
      })();
      return claimInFlight;
    };
    const start = async () => {
      try {
        userId = await ensureAuth();
        if (!active) return;
        await claimWhenVisible();
      } catch {
        update(setOffline, true);
        if (active) setConnectionState("offline");
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", disconnect);
    void start();
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", disconnect);
      stopHeartbeat();
      activeProcessor?.dispose();
      activeProcessor = null;
      disconnect();
      const currentChannel = channel;
      channel = null;
      if (currentChannel) void client.removeChannel(currentChannel);
    };
  }, [registrationKey, onCrewSessionId, onSessionInvalid]);

  return {
    offline,
    connectionState,
    duplicateName,
    needsAudioRecovery,
    deliveryUncertain,
    retryAudioUnlock: () => setNeedsAudioRecovery(false),
  };
}
