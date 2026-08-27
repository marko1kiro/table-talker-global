import { describe, expect, it, vi } from "vitest";
import {
  channelStateIsTerminal,
  canReconnectPresence,
  canProcessCatchUp,
  canSendConnectedHeartbeat,
  createChannelStatusHandler,
  createVisibleClaimCoordinator,
  deliveryIsUncertain,
  crewClaimArgs,
  crewRegistrationKey,
  createRemoteCommandProcessor,
  getAnonymousUserId,
  getRemoteCommandState,
  isInvalidSessionError,
  pruneProcessedCommands,
  shouldActivatePresence,
  replaceHeartbeatTimer,
  updateUncertainCommandIds,
} from "../src/hooks/use-remote-crew";

const command = {
  id: "command-1",
  targetSessionId: "crew-1",
  audioId: "table:7" as const,
  createdAt: "2026-08-12T10:00:02.000Z",
  expiresAt: "2026-08-12T10:00:07.000Z",
};

describe("remote crew command processor", () => {
  it("treats terminal channel states as disconnected but not initial subscribing", () => {
    expect(channelStateIsTerminal("SUBSCRIBING")).toBe(false);
    expect(channelStateIsTerminal("SUBSCRIBED")).toBe(false);
    expect(channelStateIsTerminal("CLOSED")).toBe(true);
    expect(channelStateIsTerminal("CHANNEL_ERROR")).toBe(true);
    expect(channelStateIsTerminal("TIMED_OUT")).toBe(true);
  });
  it("keeps terminal channels offline across hidden-visible transitions", () => {
    expect(canSendConnectedHeartbeat(false, "visible")).toBe(true);
    expect(canSendConnectedHeartbeat(true, "hidden")).toBe(false);
    expect(canSendConnectedHeartbeat(true, "visible")).toBe(false);
  });

  it("activates connected presence only after realtime subscription", () => {
    expect(shouldActivatePresence("SUBSCRIBING")).toBe(false);
    expect(shouldActivatePresence("SUBSCRIBED")).toBe(true);
    expect(shouldActivatePresence("CLOSED")).toBe(false);
  });

  it("claims a foreground crew name visibly before realtime subscribes", () => {
    const registration = {
      displayName: "Crew",
      normalizedName: "crew",
      audioReady: true,
      restaurantId: "test-restaurant-id",
      tenantToken: "signed-tenant-token",
      crewSessionToken: "issued-crew-session-token",
    };

    expect(crewClaimArgs(registration, "Browser", "visible")).toMatchObject({
      p_visibility_state: "visible",
      p_tenant_token: "signed-tenant-token",
    });
    expect(crewClaimArgs(registration, "Browser", "hidden")).toBeNull();
    expect(shouldActivatePresence("SUBSCRIBING")).toBe(false);
  });

  it("keeps remote registration stable when claim issues crew credentials", () => {
    const registration = {
      displayName: "Crew",
      normalizedName: "crew",
      audioReady: true,
      restaurantId: "test-restaurant-id",
      tenantToken: "signed-tenant-token",
      crewSessionToken: "",
    };

    expect(crewRegistrationKey(registration)).toBe(
      crewRegistrationKey({
        ...registration,
        crewSessionToken: "issued-crew-session-token",
      }),
    );
  });

  it("defers a hidden claim after anonymous auth resolves, then claims and subscribes once visible", async () => {
    let resolveAuth!: (userId: string) => void;
    const ensureAuth = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAuth = resolve;
        }),
    );
    let visible = true;
    const claim = vi.fn().mockResolvedValue(true);
    const subscribe = vi.fn();
    const coordinator = createVisibleClaimCoordinator({
      ensureAuth,
      isVisible: () => visible,
      claim,
      subscribe,
    });

    void coordinator.start();
    visible = false;
    resolveAuth("crew-1");
    await vi.waitFor(() => expect(ensureAuth).toHaveBeenCalledOnce());
    expect(claim).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();

    visible = true;
    await coordinator.claimWhenVisible();
    await coordinator.claimWhenVisible();

    expect(claim).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
  });

  it("ignores a removed channel's late terminal callback", () => {
    const channelA = {};
    const channelB = {};
    let currentChannel: object | null = channelA;
    const stopHeartbeat = vi.fn();
    const disconnect = vi.fn();
    const setOffline = vi.fn();
    const setConnectionState = vi.fn();
    const removeChannel = vi.fn();
    const handlerA = createChannelStatusHandler({
      channel: channelA,
      currentChannel: () => currentChannel,
      stopHeartbeat,
      disconnect,
      setOffline,
      setConnectionState,
      removeChannel,
      activatePresence: vi.fn(),
    });

    currentChannel = channelB;
    handlerA("CLOSED");

    expect(stopHeartbeat).not.toHaveBeenCalled();
    expect(disconnect).not.toHaveBeenCalled();
    expect(setOffline).not.toHaveBeenCalled();
    expect(setConnectionState).not.toHaveBeenCalled();
    expect(removeChannel).not.toHaveBeenCalled();
  });

  it("replaces the heartbeat timer on repeated subscription", () => {
    const clear = vi.fn();
    const start = vi.fn().mockReturnValue("next-timer");

    expect(replaceHeartbeatTimer("old-timer", clear, start)).toBe("next-timer");
    expect(clear).toHaveBeenCalledWith("old-timer");
    expect(start).toHaveBeenCalledOnce();
  });

  it("shares a pending anonymous sign-in for one client", async () => {
    const signInAnonymously = vi.fn().mockResolvedValue({
      data: { user: { id: "crew-1" } },
      error: null,
    });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }), signInAnonymously },
    };

    await Promise.all([getAnonymousUserId(client as never), getAnonymousUserId(client as never)]);

    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it("retries anonymous authentication after a rejected cached attempt", async () => {
    const signInAnonymously = vi
      .fn()
      .mockResolvedValueOnce({ data: { user: null }, error: new Error("offline") })
      .mockResolvedValueOnce({ data: { user: { id: "crew-1" } }, error: null });
    const client = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }), signInAnonymously },
    };

    await expect(getAnonymousUserId(client as never)).rejects.toThrow("offline");
    await expect(getAnonymousUserId(client as never)).resolves.toBe("crew-1");

    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it("uses a restored authenticated UID without anonymous sign-in", async () => {
    const signInAnonymously = vi.fn();
    const client = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "restored-crew" } } }),
        signInAnonymously,
      },
    };

    await expect(getAnonymousUserId(client as never)).resolves.toBe("restored-crew");
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("reconnects only from a visible page", () => {
    expect(canReconnectPresence("visible")).toBe(true);
    expect(canReconnectPresence("hidden")).toBe(false);
  });

  it("does not make hidden or missed commands replayable after reconnect", async () => {
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:08.000Z"),
    });

    await processor.process(command);
    expect(playRemoteAudio).not.toHaveBeenCalled();
  });

  it("prunes expired replay IDs without evicting live duplicates", () => {
    const processedIds = new Map([
      ["expired", { expiresAt: 1, processedAt: 1 }],
      ["live", { expiresAt: 100_000, processedAt: 100_000 }],
      ...Array.from(
        { length: 255 },
        (_, index) =>
          [`id-${index}`, { expiresAt: 100_000 + index, processedAt: 100_000 + index }] as const,
      ),
    ]);

    pruneProcessedCommands(processedIds, 40_000);

    expect(processedIds.has("expired")).toBe(false);
    expect(processedIds.has("live")).toBe(true);
    expect(processedIds.size).toBe(256);
  });

  it("caps unexpired replay IDs by deterministic oldest entry", () => {
    const processedIds = new Map(
      Array.from(
        { length: 257 },
        (_, index) => [`id-${index}`, { expiresAt: 100_000, processedAt: index }] as const,
      ),
    );

    pruneProcessedCommands(processedIds, 1);

    expect(processedIds.size).toBe(256);
    expect(processedIds.has("id-0")).toBe(false);
    expect(processedIds.has("id-256")).toBe(true);
  });

  it("caps replay IDs after inserting beyond exactly 256 entries", async () => {
    const state = {
      processedIds: new Map<string, { expiresAt: number; processedAt: number }>(
        Array.from(
          { length: 256 },
          (_, index) =>
            [
              `id-${index}`,
              { expiresAt: Date.parse("2026-08-12T10:00:07.000Z"), processedAt: index },
            ] as const,
        ),
      ),
      newest: { createdAt: "2026-08-12T10:00:01.000Z", id: "old" },
      queue: Promise.resolve(),
    };
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      state,
    });

    await processor.process({ ...command, id: "new" });

    expect(state.processedIds.size).toBe(256);
    expect(state.processedIds.has("id-0")).toBe(false);
    expect(state.processedIds.has("new")).toBe(true);
  });

  it("preserves processed commands across processors for one client and UID", async () => {
    const client = {} as never;
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const options = {
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      state: getRemoteCommandState(client, "crew-1"),
    };

    await createRemoteCommandProcessor(options).process(command);
    await createRemoteCommandProcessor(options).process(command);

    expect(playRemoteAudio).toHaveBeenCalledOnce();
  });

  it("marks a valid command processed before playback and ignores its duplicate", async () => {
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
    });

    await processor.process(command);
    await processor.process(command);

    expect(playRemoteAudio).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledWith(command.id, "played", null);
  });

  it("plays only a newer valid command", async () => {
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:04.000Z"),
    });

    await processor.process({ ...command, id: "new", createdAt: "2026-08-12T10:00:03.000Z" });
    await processor.process({ ...command, id: "old", createdAt: "2026-08-12T10:00:02.000Z" });

    expect(playRemoteAudio).toHaveBeenCalledOnce();
  });

  it("accepts concurrent arrivals but never starts an older command after a newer one", async () => {
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:04.000Z"),
    });

    const old = processor.process({ ...command, id: "old", createdAt: "2026-08-12T10:00:02.000Z" });
    const newest = processor.process({
      ...command,
      id: "new",
      createdAt: "2026-08-12T10:00:03.000Z",
    });
    await Promise.all([old, newest]);

    expect(playRemoteAudio).toHaveBeenCalledOnce();
    expect(playRemoteAudio).toHaveBeenCalledWith("table:7");
  });

  it("uses lexicographic IDs to order equal creation timestamps", async () => {
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:04.000Z"),
    });

    await processor.process({ ...command, id: "b" });
    await processor.process({ ...command, id: "a" });

    expect(playRemoteAudio).toHaveBeenCalledOnce();
  });

  it("discards a queued command that expires before playback", async () => {
    let now = Date.parse("2026-08-12T10:00:03.000Z");
    let releaseFirst: (() => void) | undefined;
    const firstPlayback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const playRemoteAudio = vi
      .fn()
      .mockImplementationOnce(() => firstPlayback)
      .mockResolvedValue(undefined);
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge,
      now: () => now,
    });

    const first = processor.process({ ...command, id: "a", createdAt: "2026-08-12T10:00:01.000Z" });
    await vi.waitFor(() => expect(playRemoteAudio).toHaveBeenCalledOnce());
    const queued = processor.process({
      ...command,
      id: "b",
      createdAt: "2026-08-12T10:00:02.000Z",
    });
    now = Date.parse("2026-08-12T10:00:08.000Z");
    releaseFirst?.();
    await Promise.all([first, queued]);

    expect(playRemoteAudio).toHaveBeenCalledOnce();
    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("discards a queued command when visibility becomes hidden", async () => {
    let visible = true;
    let releaseFirst: (() => void) | undefined;
    const firstPlayback = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const playRemoteAudio = vi
      .fn()
      .mockImplementationOnce(() => firstPlayback)
      .mockResolvedValue(undefined);
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      isVisible: () => visible,
    });

    const first = processor.process({ ...command, id: "a", createdAt: "2026-08-12T10:00:01.000Z" });
    await vi.waitFor(() => expect(playRemoteAudio).toHaveBeenCalledOnce());
    const queued = processor.process({
      ...command,
      id: "b",
      createdAt: "2026-08-12T10:00:02.000Z",
    });
    visible = false;
    releaseFirst?.();
    await Promise.all([first, queued]);
    await processor.process({ ...command, id: "b", createdAt: "2026-08-12T10:00:02.000Z" });

    expect(playRemoteAudio).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it("acknowledges playback failure once and reports acknowledgement uncertainty", async () => {
    const onNeedsAudioRecovery = vi.fn();
    const onPending = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockRejectedValue(new Error("autoplay blocked")),
      acknowledge: vi.fn().mockRejectedValue(new Error("offline")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      onNeedsAudioRecovery,
      onPending,
    });

    await processor.process(command);
    await processor.process(command);

    expect(onNeedsAudioRecovery).toHaveBeenCalledOnce();
    expect(onPending).toHaveBeenCalledOnce();
  });

  it("retries a failed acknowledgement without replaying audio", async () => {
    let retry: (() => void) | undefined;
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      schedule: (callback) => {
        retry = callback;
        return "retry" as never;
      },
      cancel: vi.fn(),
    });

    await processor.process(command);
    await processor.process(command);
    expect(playRemoteAudio).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenCalledOnce();

    retry?.();
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
    expect(playRemoteAudio).toHaveBeenCalledOnce();
  });

  it("retries failed playback acknowledgement without replaying failed audio", async () => {
    let retry: (() => void) | undefined;
    const playRemoteAudio = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      schedule: (callback) => {
        retry = callback;
        return "retry" as never;
      },
      cancel: vi.fn(),
    });

    await processor.process(command);
    retry?.();
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));

    expect(playRemoteAudio).toHaveBeenCalledOnce();
    expect(acknowledge).toHaveBeenNthCalledWith(1, command.id, "failed", "autoplay blocked");
  });

  it("stops retries after acknowledgement expiry", async () => {
    let now = Date.parse("2026-08-12T10:00:03.000Z");
    let retry: (() => void) | undefined;
    const acknowledge = vi.fn().mockRejectedValue(new Error("offline"));
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge,
      now: () => now,
      schedule: (callback) => {
        retry = callback;
        return "retry" as never;
      },
      cancel: vi.fn(),
    });

    await processor.process(command);
    now = Date.parse(command.expiresAt);
    retry?.();
    await Promise.resolve();

    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it("does not acknowledge when playback crosses command expiry", async () => {
    let now = Date.parse("2026-08-12T10:00:03.000Z");
    let releasePlayback!: () => void;
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: () =>
        new Promise<void>((resolve) => {
          releasePlayback = resolve;
        }),
      acknowledge,
      now: () => now,
    });

    const processing = processor.process(command);
    await vi.waitFor(() => expect(releasePlayback).toBeTypeOf("function"));
    now = Date.parse(command.expiresAt);
    releasePlayback();
    await processing;

    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("clears delivery uncertainty after retry acknowledgement succeeds", async () => {
    let retry: (() => void) | undefined;
    const onPending = vi.fn();
    const acknowledge = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      onPending,
      schedule: (callback) => {
        retry = callback;
        return "retry" as never;
      },
      cancel: vi.fn(),
    });

    await processor.process(command);
    expect(onPending).toHaveBeenLastCalledWith(command.id, true);
    retry?.();
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));

    expect(onPending).toHaveBeenLastCalledWith(command.id, false);
  });

  it("recognizes only known session invalidation codes", () => {
    expect(isInvalidSessionError(new Error("INVALID_CREW_SESSION"))).toBe(true);
    expect(isInvalidSessionError(new Error("INVALID_TENANT_SESSION"))).toBe(true);
    expect(isInvalidSessionError(new Error("SESSION_NOT_FOUND"))).toBe(true);
    expect(isInvalidSessionError(new Error("INVALID_COMMAND"))).toBe(false);
    expect(isInvalidSessionError(new Error("INVALID_STATUS"))).toBe(false);
    expect(isInvalidSessionError(new Error("INVALID_CREW_SESSION_STALE"))).toBe(false);
  });

  it("keeps expired delivery uncertainty when another command succeeds", () => {
    const ids = new Set<string>();

    expect(updateUncertainCommandIds(ids, "expired", true)).toBe(true);
    expect(updateUncertainCommandIds(ids, "delivered", false)).toBe(true);
    expect(ids).toEqual(new Set(["expired"]));
  });

  it("processes catch-up only for active processor and channel", () => {
    const processor = {};
    const channel = {};

    expect(canProcessCatchUp(true, processor, processor, channel, channel)).toBe(true);
    expect(canProcessCatchUp(false, processor, processor, channel, channel)).toBe(false);
    expect(canProcessCatchUp(true, {}, processor, channel, channel)).toBe(false);
    expect(canProcessCatchUp(true, processor, processor, {}, channel)).toBe(false);
  });

  it("keeps catch-up uncertainty after unrelated acknowledgement succeeds", () => {
    const ids = new Set<string>();

    updateUncertainCommandIds(ids, "acknowledged", false);
    expect(deliveryIsUncertain(true, ids)).toBe(true);
    expect(deliveryIsUncertain(false, ids)).toBe(false);
  });

  it("does not schedule or report after disposal while an acknowledgement rejects", async () => {
    let rejectAck!: (error: Error) => void;
    const pendingAck = new Promise<void>((_, reject) => {
      rejectAck = reject;
    });
    const schedule = vi.fn();
    const onPending = vi.fn();
    const acknowledge = vi.fn().mockReturnValue(pendingAck);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      schedule,
      cancel: vi.fn(),
      onPending,
    });

    const processing = processor.process(command);
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce());
    processor.dispose();
    rejectAck(new Error("offline"));
    await processing;

    expect(schedule).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
  });

  it("does not play commands accepted after disposal", async () => {
    const playRemoteAudio = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio,
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
    });

    processor.dispose();
    await processor.process(command);

    expect(playRemoteAudio).not.toHaveBeenCalled();
  });

  it("does not acknowledge playback completing after disposal", async () => {
    let releasePlayback!: () => void;
    const acknowledge = vi.fn().mockResolvedValue(undefined);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: () =>
        new Promise<void>((resolve) => {
          releasePlayback = resolve;
        }),
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
    });

    const processing = processor.process(command);
    await vi.waitFor(() => expect(releasePlayback).toBeTypeOf("function"));
    processor.dispose();
    releasePlayback();
    await processing;

    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("keeps expired command uncertainty when another command acknowledgement succeeds", async () => {
    let now = Date.parse("2026-08-12T10:00:03.000Z");
    let releasePlayback!: () => void;
    const onPending = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releasePlayback = resolve;
            }),
        )
        .mockResolvedValue(undefined),
      acknowledge: vi.fn().mockResolvedValue(undefined),
      now: () => now,
      onPending,
      cancel: vi.fn(),
    });

    const expired = processor.process({
      ...command,
      id: "expired",
      createdAt: "2026-08-12T10:00:01.000Z",
    });
    await vi.waitFor(() => expect(releasePlayback).toBeTypeOf("function"));
    now = Date.parse(command.expiresAt);
    releasePlayback();
    await expired;
    now = Date.parse("2026-08-12T10:00:03.000Z");
    await processor.process({ ...command, id: "delivered", createdAt: "2026-08-12T10:00:02.000Z" });

    expect(onPending).toHaveBeenLastCalledWith("delivered", false);
    expect(onPending).toHaveBeenCalledWith("expired", true);
  });

  it("retries invalid command acknowledgements without invalidating session", async () => {
    const onSessionInvalid = vi.fn();
    const schedule = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge: vi.fn().mockRejectedValue(new Error("INVALID_COMMAND")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      onSessionInvalid,
      schedule,
      cancel: vi.fn(),
    });

    await processor.process(command);

    expect(onSessionInvalid).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("limits acknowledgement retry delays to 250, 500, and 1000 milliseconds", async () => {
    const scheduled: Array<{ callback: () => void; delay: number }> = [];
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge: vi.fn().mockRejectedValue(new Error("offline")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      schedule: (callback, delay) => {
        scheduled.push({ callback, delay });
        return scheduled.length as never;
      },
      cancel: vi.fn(),
    });

    await processor.process(command);
    scheduled[0]?.callback();
    await vi.waitFor(() => expect(scheduled).toHaveLength(2));
    scheduled[1]?.callback();
    await vi.waitFor(() => expect(scheduled).toHaveLength(3));
    scheduled[2]?.callback();
    await Promise.resolve();

    expect(scheduled.map(({ delay }) => delay)).toEqual([250, 500, 1_000]);
  });

  it("invalidates session instead of retrying an invalid acknowledgement", async () => {
    const onSessionInvalid = vi.fn();
    const schedule = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge: vi.fn().mockRejectedValue(new Error("INVALID_SESSION")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      isInvalidSessionError: (error) =>
        error instanceof Error && error.message === "INVALID_SESSION",
      onSessionInvalid,
      schedule,
      cancel: vi.fn(),
    });

    await processor.process(command);

    expect(onSessionInvalid).toHaveBeenCalledOnce();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("cancels every pending retry when an acknowledgement invalidates session", async () => {
    const cancel = vi.fn();
    const onSessionInvalid = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockRejectedValueOnce(new Error("INVALID_SESSION")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      isInvalidSessionError: (error) =>
        error instanceof Error && error.message === "INVALID_SESSION",
      onSessionInvalid,
      schedule: vi.fn().mockReturnValue("first-retry" as never),
      cancel,
    });

    await processor.process({ ...command, id: "first", createdAt: "2026-08-12T10:00:01.000Z" });
    await processor.process({ ...command, id: "second", createdAt: "2026-08-12T10:00:02.000Z" });

    expect(onSessionInvalid).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith("first-retry");
  });

  it("does not issue concurrent acknowledgements for a duplicate during pending delivery", async () => {
    let rejectAck!: (error: Error) => void;
    const pendingAck = new Promise<void>((_, reject) => {
      rejectAck = reject;
    });
    const acknowledge = vi.fn().mockReturnValue(pendingAck);
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge,
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      schedule: vi.fn().mockReturnValue("retry"),
      cancel: vi.fn(),
    });

    const first = processor.process(command);
    await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce());
    void processor.process(command);
    expect(acknowledge).toHaveBeenCalledOnce();

    rejectAck(new Error("offline"));
    await first;
  });

  it("cancels pending acknowledgement retries when disposed", async () => {
    const cancel = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockResolvedValue(undefined),
      acknowledge: vi.fn().mockRejectedValue(new Error("offline")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      schedule: vi.fn().mockReturnValue("retry"),
      cancel,
    });

    await processor.process(command);
    processor.dispose();

    expect(cancel).toHaveBeenCalledWith("retry");
  });
});
