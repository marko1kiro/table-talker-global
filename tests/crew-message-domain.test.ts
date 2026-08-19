import { describe, expect, it } from "vitest";
import {
  CREW_MESSAGE_AUTO_CLOSE_MS,
  CREW_MESSAGE_MAX_LENGTH,
  CREW_MESSAGE_TTL_MS,
  isDuplicateCrewMessage,
  markDeliveredCrewMessage,
  pruneDeliveredCrewMessages,
  validateCrewMessageRequest,
} from "../src/lib/crew-message-domain";

describe("validateCrewMessageRequest", () => {
  it("accepts valid uuid target and short message", () => {
    expect(
      validateCrewMessageRequest({
        targetSessionId: "00000000-0000-0000-0000-000000000001",
        message: "Meja 5 lapor ke dapur",
      }),
    ).toEqual({
      targetSessionId: "00000000-0000-0000-0000-000000000001",
      message: "Meja 5 lapor ke dapur",
    });
  });

  it("rejects empty message", () => {
    expect(
      validateCrewMessageRequest({
        targetSessionId: "00000000-0000-0000-0000-000000000001",
        message: "   ",
      }),
    ).toEqual({ error: "Nama wajib diisi." });
  });

  it("rejects invalid target uuid", () => {
    expect(validateCrewMessageRequest({ targetSessionId: "bukan-uuid", message: "x" })).toEqual({
      error: "Crew target tidak valid.",
    });
  });

  it("rejects message over 200 chars", () => {
    expect(
      validateCrewMessageRequest({
        targetSessionId: "00000000-0000-0000-0000-000000000001",
        message: "k".repeat(201),
      }),
    ).toEqual({ error: "Pesan maksimal 200 karakter." });
  });

  it("accepts message exactly 200 chars", () => {
    expect(
      validateCrewMessageRequest({
        targetSessionId: "00000000-0000-0000-0000-000000000001",
        message: "k".repeat(200),
      }),
    ).toEqual({
      targetSessionId: "00000000-0000-0000-0000-000000000001",
      message: "k".repeat(200),
    });
  });
});

describe("delivered message dedupe", () => {
  const NOW = 1_000_000;
  it("treats unseen id as not duplicate and marks it", () => {
    const delivered = new Map<string, number>();
    expect(isDuplicateCrewMessage("m1", delivered, NOW)).toBe(false);
    markDeliveredCrewMessage("m1", delivered, NOW);
    expect(isDuplicateCrewMessage("m1", delivered, NOW)).toBe(true);
  });

  it("prunes entries older than TTL", () => {
    const delivered = new Map<string, number>([["m1", NOW - CREW_MESSAGE_TTL_MS - 1]]);
    pruneDeliveredCrewMessages(delivered, NOW);
    expect(delivered.has("m1")).toBe(false);
  });

  it("keeps entries still fresh", () => {
    const delivered = new Map<string, number>([["m2", NOW - 10]]);
    pruneDeliveredCrewMessages(delivered, NOW);
    expect(delivered.has("m2")).toBe(true);
  });
});

describe("crew message constants", () => {
  it("200 char limit and 5s auto close", () => {
    expect(CREW_MESSAGE_MAX_LENGTH).toBe(200);
    expect(CREW_MESSAGE_AUTO_CLOSE_MS).toBe(5_000);
    expect(CREW_MESSAGE_TTL_MS).toBeGreaterThan(CREW_MESSAGE_AUTO_CLOSE_MS);
  });
});
