import { describe, expect, it } from "vitest";
import {
  crewEmptyText,
  formatScopeDate,
  scopeQueryKey,
  scopeToParams,
  wibDateKey,
  type CrewScope,
} from "../src/lib/crew-history-scope";

describe("wibDateKey", () => {
  it("formats an instant as the WIB calendar date (UTC+7)", () => {
    expect(wibDateKey(new Date("2026-09-06T16:59:00Z"))).toBe("2026-09-06"); // 23:59 WIB
    expect(wibDateKey(new Date("2026-09-06T17:00:00Z"))).toBe("2026-09-07"); // 00:00 WIB
  });
});

describe("scopeToParams", () => {
  it("maps each scope to server params", () => {
    expect(scopeToParams({ kind: "today" })).toEqual({ date: wibDateKey() });
    expect(scopeToParams({ kind: "date", date: "2026-08-01" })).toEqual({
      date: "2026-08-01",
    });
    expect(scopeToParams({ kind: "all" })).toEqual({});
  });
});

describe("scopeQueryKey", () => {
  it("keys today by the live WIB date so it refetches after midnight", () => {
    expect(scopeQueryKey({ kind: "today" })).toBe(wibDateKey());
    expect(scopeQueryKey({ kind: "date", date: "2026-08-01" })).toBe("2026-08-01");
    expect(scopeQueryKey({ kind: "all" })).toBe("all");
  });
});

describe("formatScopeDate", () => {
  it("formats a YYYY-MM-DD key in Indonesian", () => {
    expect(formatScopeDate("2026-09-06")).toBe("Min, 6 Sep 2026");
  });
});

describe("crewEmptyText", () => {
  it("returns a scope-aware empty message", () => {
    expect(crewEmptyText({ kind: "today" })).toBe("Belum ada crew yang check-in hari ini.");
    expect(crewEmptyText({ kind: "date", date: "2026-08-01" })).toBe(
      "Belum ada crew check-in di tanggal ini.",
    );
    expect(crewEmptyText({ kind: "all" })).toBe("Belum ada riwayat kehadiran.");
  });
});
