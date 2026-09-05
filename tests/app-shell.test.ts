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
  it("has a sticky header and no standalone notice banner (moved to bell)", () => {
    const s = src();
    expect(s).toContain("sticky top-0");
    expect(s).not.toContain("notice");
  });
  it("is responsive (desktop rail + mobile drawer)", () => {
    const s = src();
    expect(s).toContain("md:flex");
    expect(s).toContain("md:hidden");
  });
  it("delegates theme to ThemeFrame and keeps dark chrome borders", () => {
    const s = src();
    expect(s).toContain("ThemeFrame");
    expect(s).toContain("dark:border-ta-gray-700");
  });
  it("swaps the header title for a logo on mobile when headerLogo is provided", () => {
    const s = src();
    expect(s).toContain("headerLogo");
    expect(s).toContain("md:hidden");
    expect(s).toContain("hidden");
    expect(s).toContain("md:block");
  });
});
