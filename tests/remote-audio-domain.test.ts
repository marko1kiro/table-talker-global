import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_CATALOG,
  TABLE_AUDIO_IDS,
  COMMAND_TTL_MS,
  FAILURE_REASON_MAX_LENGTH,
  HEARTBEAT_MS,
  ONLINE_WINDOW_MS,
  boundedFailureReason,
  classifyCrewSession,
  commandIsProcessable,
  getCatalogMetadata,
  normalizeCrewName,
  sessionIsEligible,
} from "../src/lib/remote-audio-domain";

describe("remote audio domain", () => {
  it("exposes one 100-table range and categorized announcement metadata without asset URLs", () => {
    expect(TABLE_AUDIO_IDS).toHaveLength(100);
    expect(TABLE_AUDIO_IDS[0]).toBe("table:1");
    expect(TABLE_AUDIO_IDS[99]).toBe("table:100");
    expect(ANNOUNCEMENT_CATALOG.map(({ id, category }) => ({ id, category }))).toEqual([
      { id: "seating", category: "INFO" },
      { id: "himbauan-barang-bawaan-pelanggan", category: "INFO" },
      { id: "jam-buka-resto", category: "INFO" },
      { id: "outside-food", category: "LARANGAN" },
      { id: "no-smoking", category: "LARANGAN" },
      { id: "larangan-gabung-meja", category: "LARANGAN" },
    ]);
    expect(JSON.stringify({ TABLE_AUDIO_IDS, ANNOUNCEMENT_CATALOG })).not.toContain(".mp3");
    expect(getCatalogMetadata("table:101")).toBeNull();
    expect(getCatalogMetadata("announcement:no-smoking")).toEqual({
      id: "announcement:no-smoking",
      label: "Dilarang Merokok di Area Lobby",
    });
  });

  it("normalizes valid crew names and rejects invalid input", () => {
    expect(normalizeCrewName("  Rina  ")).toEqual({
      displayName: "Rina",
      normalizedName: "rina",
    });
    expect(normalizeCrewName(" ")).toEqual({ error: "Nama wajib diisi." });
    expect(normalizeCrewName("Rina<>")).toEqual({
      error: "Nama berisi karakter yang tidak didukung.",
    });
  });

  it("requires a visible heartbeat no older than thirty seconds", () => {
    const now = Date.parse("2026-08-12T10:00:30.000Z");
    expect(HEARTBEAT_MS).toBe(10_000);
    expect(ONLINE_WINDOW_MS).toBe(30_000);
    expect(
      sessionIsEligible(
        {
          connectionState: "connected",
          visibilityState: "visible",
          audioReady: true,
          lastSeen: "2026-08-12T10:00:00.000Z",
        },
        now,
      ),
    ).toBe(true);
    expect(
      sessionIsEligible(
        {
          connectionState: "connected",
          visibilityState: "hidden",
          audioReady: true,
          lastSeen: "2026-08-12T10:00:01.000Z",
        },
        now,
      ),
    ).toBe(false);
    expect(
      sessionIsEligible(
        {
          connectionState: "connected",
          visibilityState: "visible",
          audioReady: true,
          lastSeen: "2026-08-12T10:00:31.000Z",
        },
        now,
      ),
    ).toBe(false);
  });

  it("classifies fresh visible connected crews as online, recent crews through three hours, and omits expired crews", () => {
    const now = Date.parse("2026-08-15T12:00:00.000Z");
    const base = {
      connectionState: "connected" as const,
      visibilityState: "visible" as const,
      audioReady: true,
    };

    expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T11:59:30.000Z" }, now)).toBe(
      "online",
    );
    expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T11:59:29.999Z" }, now)).toBe(
      "recent",
    );
    expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T09:00:00.000Z" }, now)).toBe(
      "recent",
    );
    expect(classifyCrewSession({ ...base, lastSeen: "2026-08-15T08:59:59.999Z" }, now)).toBe(
      "expired",
    );
    const audioUnready = { ...base, audioReady: false, lastSeen: "2026-08-15T11:59:30.000Z" };
    expect(classifyCrewSession(audioUnready, now)).toBe("online");
    expect(
      classifyCrewSession(
        { ...base, visibilityState: "hidden", lastSeen: "2026-08-15T11:59:30.000Z" },
        now,
      ),
    ).toBe("recent");
  });

  it("accepts a newest unexpired targeted command once", () => {
    const command = {
      id: "new",
      targetSessionId: "crew-1",
      audioId: "table:7" as const,
      createdAt: "2026-08-12T10:00:02.000Z",
      expiresAt: "2026-08-12T10:00:07.000Z",
    };
    const now = Date.parse("2026-08-12T10:00:03.000Z");
    expect(commandIsProcessable(command, "crew-1", new Set(), null, now)).toBe(true);
    expect(
      commandIsProcessable(
        { ...command, createdAt: "2026-08-12T10:00:04.000Z" },
        "crew-1",
        new Set(),
        null,
        now,
      ),
    ).toBe(false);
    expect(commandIsProcessable(command, "crew-1", new Set(["new"]), null, now)).toBe(false);
    expect(
      commandIsProcessable(
        { ...command, id: "old", createdAt: "2026-08-12T10:00:01.000Z" },
        "crew-1",
        new Set(),
        { createdAt: command.createdAt, id: command.id },
        now,
      ),
    ).toBe(false);
    const equalCreatedAt = { ...command, id: "b" };
    expect(
      commandIsProcessable(
        equalCreatedAt,
        "crew-1",
        new Set(),
        { createdAt: command.createdAt, id: "a" },
        now,
      ),
    ).toBe(true);
    expect(
      commandIsProcessable(
        { ...command, id: "a" },
        "crew-1",
        new Set(),
        { createdAt: command.createdAt, id: "b" },
        now,
      ),
    ).toBe(false);
    expect(COMMAND_TTL_MS).toBe(5_000);
  });

  it("bounds failure messages", () => {
    expect(boundedFailureReason("unknown")).toBe("Pemutaran audio gagal.");
    expect(boundedFailureReason(new Error("x".repeat(FAILURE_REASON_MAX_LENGTH + 1)))).toHaveLength(
      FAILURE_REASON_MAX_LENGTH,
    );
  });
});
