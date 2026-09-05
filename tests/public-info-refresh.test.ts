import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) =>
  readFileSync(new URL(`../src/routes/${p}.tsx`, import.meta.url), "utf8");

describe("public info pages reflect the current LIME feature set", () => {
  it("about covers soundboard + realtime status + QR + roles + manager + owner", () => {
    const s = read("about");
    expect(s).toContain("Status Meja Real-Time");
    expect(s).toContain("Pemesanan Mandiri via QR");
    expect(s).toContain("Kasir");
    expect(s).toContain("Satgas");
    expect(s).toContain("Clear Up");
    expect(s).toContain("Monitoring Manager");
  });
  it("faq answers manager login, auto status change, Perlu Dicek, dark mode", () => {
    const s = read("faq");
    expect(s).toContain("ID Manager");
    expect(s).toContain("Perlu Dicek");
    expect(s).toContain("mode gelap");
    expect(s).toContain("real-time");
  });
  it("privacy lists occupancy status, manager accounts, theme preference, updated date", () => {
    const s = read("privacy-policy");
    expect(s).toContain("status meja");
    expect(s).toContain("akun manager");
    expect(s).toContain("tema");
    expect(s).toContain("Terakhir diperbarui: 6 September 2026");
  });
  it("terms cover QR ordering + ID Manager secrecy + updated date", () => {
    const s = read("terms-of-use");
    expect(s).toContain("QR");
    expect(s).toContain("ID Manager");
    expect(s).toContain("Terakhir diperbarui: 6 September 2026");
  });
  it("contact mentions the current roles and the in-app help channel", () => {
    const s = read("contact");
    expect(s).toContain("Kasir");
    expect(s).toContain("Manager");
    expect(s).toContain("WhatsApp");
  });
});
