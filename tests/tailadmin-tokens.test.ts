import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = () => readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

describe("TailAdmin tokens", () => {
  it("adds brand + ta-gray + status + shadow tokens and Outfit", () => {
    const s = css();
    expect(s).toContain("--color-brand-500: #465fff");
    expect(s).toContain("--color-brand-50: #ecf3ff");
    expect(s).toContain("--color-ta-gray-50: #f9fafb");
    expect(s).toContain("--color-ta-gray-200: #e4e7ec");
    expect(s).toContain("--color-ta-success: #12b76a");
    expect(s).toContain("--color-ta-error: #f04438");
    expect(s).toContain("--shadow-theme-sm:");
    expect(s).toContain("--font-outfit:");
  });
  it("loads Outfit via the root HTML head link (not a CSS @import)", () => {
    const root = readFileSync(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
    expect(root).toContain("family=Outfit");
    expect(css()).not.toContain("@import url");
  });
  it("keeps the existing neo-brutalism tokens (crew/SS untouched)", () => {
    const s = css();
    expect(s).toContain("--brutal-bg");
    expect(s).toContain("--font-display");
    expect(s).toContain("brutal-border");
  });
});
