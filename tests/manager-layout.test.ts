import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/ManagerLayout.tsx", import.meta.url), "utf8");

describe("ManagerLayout (TailAdmin)", () => {
  it("delegates to AppShell with the three menus", () => {
    const text = source();
    expect(text).toContain("AppShell");
    expect(text).toContain("LIHAT STATUS MEJA LIVE");
    expect(text).toContain("LIHAT CREW AKTIF");
    expect(text).toContain("LOG AKTIVITAS CREW");
  });
  it("keeps the RGB neon DASHBOARD brand", () => {
    const text = source();
    expect(text).toContain("DASHBOARD");
    expect(text).toContain("bg-clip-text");
    expect(text).toContain("from-red");
  });
  it("keeps the footer branding with a copyright glyph", () => {
    const text = source();
    expect(text).toContain('from "@/components/Footer"');
    expect(text).toContain("<Footer");
    expect(text).not.toContain("MIE GACOAN");
  });
  it("does not use inline footer anymore", () => {
    const text = source();
    expect(text).not.toContain("truncate whitespace-nowrap");
    expect(text).not.toContain("lihatmeja.com");
  });
  it("passes the app logo as the mobile header brand", () => {
    const text = source();
    expect(text).toContain("headerLogo");
    expect(text).toContain("lime-logo.webp");
  });
});
