import { describe, expect, it } from "vitest";
import {
  CREW_ROLE_LABELS,
  CREW_ROLE_ORDER,
  jakartaCheckedInAtToIso,
} from "../src/lib/role-session-domain";

describe("CREW_ROLE_ORDER / CREW_ROLE_LABELS", () => {
  it("lists exactly the 4 roles in the spec's picker order: SS, Kasir, Satgas, Clear Up", () => {
    expect(CREW_ROLE_ORDER).toEqual(["ss", "kasir", "satgas", "clear_up"]);
  });

  it("provides an Indonesian display label for every role", () => {
    expect(CREW_ROLE_LABELS).toEqual({
      ss: "SS",
      kasir: "Kasir",
      satgas: "Satgas",
      clear_up: "Clear Up",
    });
  });
});

describe("jakartaCheckedInAtToIso", () => {
  it("interprets a datetime-local value as Asia/Jakarta (UTC+7) wall-clock time", () => {
    // 09:00 WIB on 2026-08-30 is 02:00 UTC the same day.
    expect(jakartaCheckedInAtToIso("2026-08-30T09:00")).toBe("2026-08-30T02:00:00.000Z");
  });

  it("handles the WIB->UTC day rollback correctly for early morning times", () => {
    // 03:15 WIB on 2026-08-30 is 20:15 UTC on 2026-08-29 (previous day).
    expect(jakartaCheckedInAtToIso("2026-08-30T03:15")).toBe("2026-08-29T20:15:00.000Z");
  });

  it("preserves seconds when the datetime-local value includes them", () => {
    expect(jakartaCheckedInAtToIso("2026-08-30T09:00:30")).toBe("2026-08-30T02:00:30.000Z");
  });

  it("returns null for an empty or malformed value rather than throwing", () => {
    expect(jakartaCheckedInAtToIso("")).toBeNull();
    expect(jakartaCheckedInAtToIso("not-a-date")).toBeNull();
    expect(jakartaCheckedInAtToIso("2026-13-99T99:99")).toBeNull();
  });
});
