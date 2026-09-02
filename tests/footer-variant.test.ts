import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Footer kini punya varian dark untuk halaman berlatar gelap (login owner).
// Varian light (default) tetap neo-brutalism untuk halaman publik -- jangan
// berubah. AuthGate harus memakai variant="dark" dan tidak lagi menimpa
// style dasar footer lewat className (penyebab latar krem + border dobel
// di halaman login gelap).
const footer = () => readFileSync(new URL("../src/components/Footer.tsx", import.meta.url), "utf8");

it("supports a dark variant with dark-mode classes", () => {
  const source = footer();
  expect(source).toContain('variant?: "light" | "dark"');
  expect(source).toContain('variant === "dark"');
  expect(source).toContain("bg-slate-950");
  expect(source).toContain("border-white/10");
});

it("keeps the light neo-brutalism default untouched", () => {
  const source = footer();
  expect(source).toContain("border-t-[3px] border-foreground bg-brutal-bg");
  expect(source).toContain('variant = "light"');
});

it("AuthGate uses the footer dark variant instead of className overrides", () => {
  const authGate = readFileSync(new URL("../src/components/AuthGate.tsx", import.meta.url), "utf8");
  expect(authGate).toContain('<Footer variant="dark"');
  expect(authGate).not.toContain('bg-slate-950 text-slate-400" />');
});
