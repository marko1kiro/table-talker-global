import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("footer english labels and layout", () => {
  const footer = read("../src/components/Footer.tsx");

  it("menggunakan teks bahasa Inggris untuk semua link", () => {
    expect(footer).toContain('"About"');
    expect(footer).toContain('"FAQ"');
    expect(footer).toContain('"Contact"');
    expect(footer).toContain('"Privacy Policy"');
    expect(footer).toContain('"Terms of Use"');

    expect(footer).not.toContain('"Tentang"');
    expect(footer).not.toContain('"Kontak"');
    expect(footer).not.toContain('"Kebijakan Privasi"');
    expect(footer).not.toContain('"Syarat Penggunaan"');
  });

  it("nav footer dibatasi max-w agar muat 2 baris rapi", () => {
    expect(footer).toMatch(/max-w-(?:xs|sm|md)/);
  });

  it("copyright dan branding rapat dan 1 baris di desktop", () => {
    expect(footer).toContain("sm:flex-row");
    expect(footer).toContain("Simplify Your Mind");
  });
});
