import { describe, expect, it, vi } from "vitest";
import {
  channelStateIsTerminal,
  canSendConnectedHeartbeat,
  createRemoteCommandProcessor,
  getAnonymousUserId,
  getRemoteCommandState,
  pruneProcessedCommands,
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
    expect(acknowledge).toHaveBeenCalledTimes(1);
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
    const onDeliveryUncertain = vi.fn();
    const processor = createRemoteCommandProcessor({
      sessionId: "crew-1",
      playRemoteAudio: vi.fn().mockRejectedValue(new Error("autoplay blocked")),
      acknowledge: vi.fn().mockRejectedValue(new Error("offline")),
      now: () => Date.parse("2026-08-12T10:00:03.000Z"),
      onNeedsAudioRecovery,
      onDeliveryUncertain,
    });

    await processor.process(command);
    await processor.process(command);

    expect(onNeedsAudioRecovery).toHaveBeenCalledOnce();
    expect(onDeliveryUncertain).toHaveBeenCalledOnce();
  });
});
