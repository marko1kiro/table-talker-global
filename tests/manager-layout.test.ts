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
  it("renders the footer branding with a copyright glyph and no resto-code line", () => {
    const text = source();
    expect(text).toContain("©");
    expect(text).toContain("XDIRGA LABS");
    expect(text).not.toContain("MIE GACOAN");
    expect(text).toContain("FooterBranding");
  });
  it("is responsive (mobile drawer + desktop rail)", () => {
    const text = source();
    expect(text).toContain("md:hidden");
    expect(text).toContain("hidden md:");
  });
  it("styles the rail (mobile + desktop): cyan active, sticky aside, shared RGB title", () => {
    const text = source();
    expect(text).toContain("bg-cyan-500");
    expect(text).toContain("md:sticky");
    expect(text).toContain("RailTitle");
    expect(text).toContain("DASHBOARD");
    expect(text).toContain("bg-clip-text");
    expect(text).toContain("from-red");
    expect(text).toContain("justify-center");
  });
});
