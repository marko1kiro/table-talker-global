import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/auth.tsx", import.meta.url), "utf8");

describe("dashboard/auth primitives", () => {
  it("IconField renders a leading icon + label-less input with a trailing slot", () => {
    const s = src();
    expect(s).toContain("export function IconField");
    expect(s).toContain("aria-label");
    expect(s).toContain("pl-11");
    expect(s).toContain("trailing");
    expect(s).toContain("{...inputProps}");
  });
  it("AuthShell centers a TailAdmin card with a logo container", () => {
    const s = src();
    expect(s).toContain("export function AuthShell");
    expect(s).toContain("bg-brand-50");
    expect(s).toContain("shadow-theme-md");
    expect(s).toContain("font-outfit");
  });
  it("input base carries dark variants", () => {
    expect(src()).toContain("dark:bg-ta-gray-900");
  });
});
