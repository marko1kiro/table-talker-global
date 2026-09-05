import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const clean = (p: string) => {
  const s = read(p);
  expect(s).not.toContain("brutal-border");
  expect(s).not.toContain("brutal-shadow");
  expect(s).not.toContain("bg-brutal-bg");
};

describe("SS/public de-brutalism", () => {
  it("Header.tsx", () => clean("../src/components/Header.tsx"));
  it("Footer.tsx", () => clean("../src/components/Footer.tsx"));
  it("TableButton.tsx", () => clean("../src/components/TableButton.tsx"));
  it("SoundboardGrid.tsx", () => clean("../src/components/SoundboardGrid.tsx"));
  it("Header uses the TailAdmin cluster (emblem + toggle), no bell", () => {
    const s = read("../src/components/Header.tsx");
    expect(s).toContain("RoleEmblem");
    expect(s).toContain("ThemeToggle");
    expect(s).toContain("lime-logo.webp");
    expect(s).not.toContain("NotificationCenter");
  });
});
