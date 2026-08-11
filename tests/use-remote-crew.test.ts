import { describe, expect, it, vi } from "vitest";
import { createRemoteCommandProcessor, getAnonymousUserId } from "../src/hooks/use-remote-crew";

const command = {
  id: "command-1",
  targetSessionId: "crew-1",
  audioId: "table:7" as const,
  createdAt: "2026-08-12T10:00:02.000Z",
  expiresAt: "2026-08-12T10:00:07.000Z",
};

describe("remote crew command processor", () => {
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
