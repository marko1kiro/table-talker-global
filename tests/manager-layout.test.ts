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
  it("renders the footer branding", () => {
    const text = source();
    expect(text).toContain("lihatmeja.com (c)2026");
    expect(text).toContain("XDIRGA LABS");
  });
  it("is responsive (mobile drawer + desktop rail)", () => {
    const text = source();
    expect(text).toContain("md:hidden");
    expect(text).toContain("hidden md:");
  });
});
