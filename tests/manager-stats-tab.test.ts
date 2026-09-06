import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync(
  new URL("../src/components/ManagerLayout.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(new URL("../src/routes/manager/index.tsx", import.meta.url), "utf8");

describe("manager stats tab", () => {
  it("ManagerMenu type includes stats", () => {
    expect(layout).toContain('"stats"');
  });
  it("layout has Statistik label", () => {
    expect(layout).toContain("STATISTIK");
  });
  it("layout imports BarChart3", () => {
    expect(layout).toContain("BarChart3");
  });
  it("page imports getManagerDailyStats", () => {
    expect(page).toContain("getManagerDailyStats");
  });
  it("page imports buildManagerCsv", () => {
    expect(page).toContain("buildManagerCsv");
  });
  it("page imports downloadCsv", () => {
    expect(page).toContain("downloadCsv");
  });
  it("page has Download Laporan CSV button text", () => {
    expect(page).toContain("Download Laporan CSV");
  });
  it("page has manager-daily-stats query key", () => {
    expect(page).toContain("manager-daily-stats");
  });
});
