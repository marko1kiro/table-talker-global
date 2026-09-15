import { describe, expect, it } from "vitest";
import { pastWibDates } from "../src/lib/am-trend";

describe("pastWibDates", () => {
  it("7 trailing berakhir di tanggal dipilih, ascending", () => {
    expect(pastWibDates("2026-09-15", 7)).toEqual([
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
      "2026-09-14",
      "2026-09-15",
    ]);
  });
  it("lewat batas bulan", () => {
    expect(pastWibDates("2026-09-01", 3)).toEqual(["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
  it("n=1 hanya tanggal akhir", () => {
    expect(pastWibDates("2026-09-15", 1)).toEqual(["2026-09-15"]);
  });
});
