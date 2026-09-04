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

describe("NotificationBell", () => {
  it("shows a count badge and a demo-style dropdown of stale tables", () => {
    const s = src("NotificationBell.tsx");
    expect(s).toContain("Bell");
    expect(s).toContain("Notifikasi");
    expect(s).toContain("perlu dicek");
    expect(s).toContain("Tidak ada meja perlu dicek");
    expect(s).toContain("items.length");
    expect(s).toContain("Clock");
  });
});
