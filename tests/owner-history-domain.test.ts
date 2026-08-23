import { describe, expect, it } from "vitest";
import {
  normalizeHistoryRange,
  normalizeHistorySearch,
  validateResolutionNote,
} from "../src/lib/owner-history-domain";

describe("owner history domain", () => {
  const now = new Date("2026-08-24T00:00:00.000Z");

  it("defaults to seven days", () => {
    expect(normalizeHistoryRange({}, now)).toEqual({
      ok: true,
      from: "2026-08-17T00:00:00.000Z",
      to: "2026-08-24T00:00:00.000Z",
      days: 7,
    });
  });

  it("rejects invalid and over-thirty-day ranges", () => {
    expect(normalizeHistoryRange({ from: "invalid" }, now)).toEqual({
      ok: false,
      code: "INVALID_RANGE",
    });
    expect(
      normalizeHistoryRange(
        {
          from: "2026-07-01T00:00:00.000Z",
          to: now.toISOString(),
        },
        now,
      ),
    ).toEqual({ ok: false, code: "RANGE_TOO_WIDE" });
  });

  it("normalizes bounded search text", () => {
    expect(normalizeHistorySearch("  meja 12  ")).toEqual({
      ok: true,
      text: "meja 12",
    });
    expect(normalizeHistorySearch("x".repeat(101))).toEqual({
      ok: false,
      code: "INVALID_SEARCH",
    });
    expect(normalizeHistorySearch("meja,or(status.eq.failed)")).toEqual({
      ok: false,
      code: "INVALID_SEARCH",
    });
    expect(normalizeHistorySearch("100% gagal")).toEqual({
      ok: false,
      code: "INVALID_SEARCH",
    });
  });

  it("accepts omitted notes and trims bounded notes", () => {
    expect(validateResolutionNote(undefined)).toEqual({ ok: true, note: null });
    expect(validateResolutionNote("  selesai  ")).toEqual({
      ok: true,
      note: "selesai",
    });
    expect(validateResolutionNote("x".repeat(1001))).toEqual({
      ok: false,
      code: "INVALID_NOTE",
    });
  });
});
