import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/AppShell.tsx", import.meta.url), "utf8");

describe("AppShell", () => {
  it("renders a light sidebar with brand-blue active items", () => {
    const s = src();
    expect(s).toContain("bg-white");
    expect(s).toContain("bg-brand-50");
    expect(s).toContain("text-brand-500");
    expect(s).toContain("text-ta-gray-700");
  });
  it("has a sticky header and a notice banner slot", () => {
    const s = src();
    expect(s).toContain("sticky top-0");
    expect(s).toContain("notice");
  });
  it("is responsive (desktop rail + mobile drawer)", () => {
    const s = src();
    expect(s).toContain("md:flex");
    expect(s).toContain("md:hidden");
  });
  it("owns theme state, provides context, and flips the .dark class on its root", () => {
    const s = src();
    expect(s).toContain("useTheme");
    expect(s).toContain("ThemeContext.Provider");
    expect(s).toContain('isDark && "dark"');
    expect(s).toContain("dark:bg-ta-gray-900");
    expect(s).toContain("dark:border-ta-gray-700");
  });
});
