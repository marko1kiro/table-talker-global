import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/ManagerLayout.tsx", import.meta.url), "utf8");

describe("ManagerLayout", () => {
  it("renders the three sidebar menus", () => {
    const text = source();
    expect(text).toContain("LIHAT STATUS MEJA LIVE");
    expect(text).toContain("LIHAT CREW AKTIF");
    expect(text).toContain("LOG AKTIVITAS CREW");
  });
  it("renders the footer branding with a copyright glyph", () => {
    const text = source();
    expect(text).toContain("©");
    expect(text).toContain("XDIRGA LABS");
  });
  it("is responsive (mobile drawer + desktop rail)", () => {
    const text = source();
    expect(text).toContain("md:hidden");
    expect(text).toContain("hidden md:");
  });
  it("styles the desktop rail: cyan active item, sticky aside, RGB static title", () => {
    const text = source();
    expect(text).toContain("bg-cyan-500");
    expect(text).toContain("md:sticky");
    expect(text).toContain("DASHBOARD");
    expect(text).toContain("bg-clip-text");
    expect(text).toContain("from-red");
    expect(text).toContain("justify-center");
  });
});
