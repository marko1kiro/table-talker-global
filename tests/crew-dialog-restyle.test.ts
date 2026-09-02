import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Restyle dialog konfirmasi crew (Kasir/Satgas/Clear Up): isi dialog harus
// memakai token gaya crew dari CrewHeader, bukan lagi token gaya Super Admin
// (ownerPrimaryButtonClass). Perilaku/teks/handler tidak berubah -- test
// kontrak dialog yang ada di kasir-route/satgas-route/clear-up-route tetap
// menjadi pengawas.
const crewHeader = () =>
  readFileSync(new URL("../src/components/CrewHeader.tsx", import.meta.url), "utf8");

const route = (name: string) =>
  readFileSync(new URL(`../src/routes/${name}/index.tsx`, import.meta.url), "utf8");

const dialogBlock = (source: string) => source.match(/<AlertDialog[\s\S]*?<\/AlertDialog>/)?.[0];

it("ships shared crew dialog button tokens from CrewHeader", () => {
  const source = crewHeader();
  expect(source).toContain("export const crewPrimaryButtonClass");
  expect(source).toContain("export const crewSecondaryButtonClass");
});

it("kasir dialog uses crew tokens instead of owner styles", () => {
  const dialog = dialogBlock(route("kasir"));
  expect(dialog).not.toBeNull();
  expect(dialog).toContain("crewPrimaryButtonClass");
  expect(dialog).toContain("crewSecondaryButtonClass");
  expect(dialog).not.toContain("ownerPrimaryButtonClass");
});

it("satgas dialog uses crew tokens instead of owner styles", () => {
  const dialog = dialogBlock(route("satgas"));
  expect(dialog).not.toBeNull();
  expect(dialog).toContain("crewPrimaryButtonClass");
  expect(dialog).toContain("crewSecondaryButtonClass");
  expect(dialog).not.toContain("ownerPrimaryButtonClass");
});

it("clear-up dialog uses crew tokens instead of owner styles", () => {
  const dialog = dialogBlock(route("clear-up"));
  expect(dialog).not.toBeNull();
  expect(dialog).toContain("crewPrimaryButtonClass");
  expect(dialog).toContain("crewSecondaryButtonClass");
  expect(dialog).not.toContain("ownerPrimaryButtonClass");
});
