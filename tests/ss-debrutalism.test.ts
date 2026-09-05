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
  it("SyncDialog.tsx", () => clean("../src/components/SyncDialog.tsx"));
  it("RestaurantCredentialDialog.tsx", () =>
    clean("../src/components/RestaurantCredentialDialog.tsx"));
  it("routes/index.tsx", () => clean("../src/routes/index.tsx"));
  it("routes/__root.tsx", () => clean("../src/routes/__root.tsx"));
  it("SS station wrapped in ThemeFrame", () => {
    expect(read("../src/routes/index.tsx")).toContain("ThemeFrame");
  });
  for (const page of ["about", "faq", "contact", "help", "privacy-policy", "terms-of-use"]) {
    it(`public page ${page}`, () => {
      clean(`../src/routes/${page}.tsx`);
      expect(read(`../src/routes/${page}.tsx`)).toContain("ThemeFrame");
    });
  }
  it("Header uses the TailAdmin cluster (emblem + toggle), no bell", () => {
    const s = read("../src/components/Header.tsx");
    expect(s).toContain("RoleEmblem");
    expect(s).toContain("ThemeToggle");
    expect(s).toContain("lime-logo.webp");
    expect(s).not.toContain("NotificationCenter");
  });
});
