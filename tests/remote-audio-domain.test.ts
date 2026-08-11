import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_CATALOG,
  COMMAND_TTL_MS,
  FAILURE_REASON_MAX_LENGTH,
  HEARTBEAT_MS,
  ONLINE_WINDOW_MS,
  boundedFailureReason,
  commandIsProcessable,
  getCatalogMetadata,
  normalizeCrewName,
  sessionIsEligible,
} from "../src/lib/remote-audio-domain";

describe("remote audio domain", () => {
  it("exposes 70 table IDs and six existing announcement IDs without asset URLs", () => {
    expect(
      Array.from({ length: 70 }, (_, index) => getCatalogMetadata(`table:${index + 1}`)?.id),
    ).toEqual(Array.from({ length: 70 }, (_, index) => `table:${index + 1}`));
    expect(getCatalogMetadata("table:71")).toBeNull();
    expect(ANNOUNCEMENT_CATALOG.map(({ id }) => id)).toEqual([
      "seating",
      "himbauan-barang-bawaan-pelanggan",
      "outside-food",
      "no-smoking",
      "larangan-gabung-meja",
      "jam-buka-resto",
    ]);
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
    expect(commandIsProcessable(command, "crew-1", new Set(["new"]), null, now)).toBe(false);
    expect(
      commandIsProcessable(
        { ...command, id: "old", createdAt: "2026-08-12T10:00:01.000Z" },
        "crew-1",
        new Set(),
        command.createdAt,
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
