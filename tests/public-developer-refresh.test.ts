import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("public info developer refresh", () => {
  const footer = read("../src/components/Footer.tsx");
  const about = read("../src/routes/about.tsx");
  const faq = read("../src/routes/faq.tsx");
  const contact = read("../src/routes/contact.tsx");

  it("Footer menampilkan tagline Simplify Your Mind", () => {
    expect(footer).toContain("Simplify Your Mind");
  });

  it("About menampilkan info developer XDIRGA LABS + low-code + custom app", () => {
    expect(about).toContain("XDIRGA LABS");
    expect(about).toContain("Simplify Your Mind");
    expect(about).toContain("Bekasi");
    expect(about).toContain("low-code");
    expect(about).toContain("aplikasi custom");
  });

  it("FAQ menampilkan pertanyaan lisensi audio", () => {
    expect(faq).toContain("lisensi");
    expect(faq).toContain("ElevenLabs");
    expect(faq).toContain("Commercial Use");
  });

  it("Contact menampilkan kontak developer (email + sosmed)", () => {
    expect(contact).toContain("XDIRGA LABS");
    expect(contact).toContain("support@lihatmeja.com");
    expect(contact).toContain("@fajarcardicians");
    expect(contact).toContain("@miraclemarko");
    expect(contact).toContain("facebook.com/hipnotismagic");
    expect(contact).toContain("Bekasi");
  });
});
