import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("SS soundboard polish", () => {
  it("TableButton has the LIME gradient border (blue-cyan-magenta)", () => {
    const s = read("../src/components/TableButton.tsx");
    expect(s).toContain("bg-gradient-to-br from-blue-500 via-cyan-400 to-fuchsia-500");
  });
  it("TableButton number colors: green ready, red playing, gray while another plays", () => {
    const s = read("../src/components/TableButton.tsx");
    expect(s).toContain("text-emerald-600");
    expect(s).toContain("text-red-600");
    expect(s).toContain("dimmedReady");
  });
  it("station title is less heavy (font-bold, not font-black)", () => {
    const s = read("../src/routes/index.tsx");
    expect(s).not.toContain("font-black");
    expect(s).toContain("Pilih Nomor Meja");
  });
  it("Stop button sits above the announcement trigger without shifting it", () => {
    const idx = read("../src/routes/index.tsx");
    const grid = read("../src/components/SoundboardGrid.tsx");
    expect(idx).toContain("bottom-20 right-4");
    expect(idx).not.toContain("announcementTriggerElevated");
    expect(grid).not.toContain("announcementTriggerElevated");
    expect(grid).toContain("bottom-4");
  });
});
