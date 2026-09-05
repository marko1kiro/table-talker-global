import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/ThemeFrame.tsx", import.meta.url), "utf8");

describe("ThemeFrame", () => {
  it("provides theme context and flips .dark on its root", () => {
    const s = src();
    expect(s).toContain("ThemeContext.Provider");
    expect(s).toContain('isDark && "dark"');
    expect(s).toContain("useTheme");
  });
});
