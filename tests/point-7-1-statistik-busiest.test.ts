import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("statistik default busiest", () => {
  it("pakai snapshot paralel + stored-menang + tanpa cast", () => {
    const src = readFileSync("src/routes/am/statistik.tsx", "utf8");
    expect(src).toMatch(/amTableSnapshot/);
    expect(src).toMatch(/busiest/);
    expect(src).toMatch(/loadRestoPick\("statistik"\)/);
    expect(src).toMatch(/stored\s+\? resolveRestoPick\(stored/);
    expect(src).not.toMatch(/active as string/);
    expect(src).toMatch(/if \(!active\) throw/);
  });
});
