import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (f: string) =>
  readFileSync(new URL(`../src/components/dashboard/${f}`, import.meta.url), "utf8");

describe("ThemeToggle", () => {
  it("consumes theme context and shows sun/moon with an aria-label", () => {
    const s = src("ThemeToggle.tsx");
    expect(s).toContain("useThemeValue");
    expect(s).toContain("Moon");
    expect(s).toContain("Sun");
    expect(s).toContain("aria-label");
    expect(s).toContain("onClick={toggle}");
  });
});
