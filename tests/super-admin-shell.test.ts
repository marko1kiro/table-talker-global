import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = [
  "index",
  "restaurants/index",
  "restaurants/$id",
  "audio",
  "history",
  "error-log",
  "esb-export",
  "managers",
];
const read = (p: string) =>
  readFileSync(new URL(`../src/routes/super-admin/${p}.tsx`, import.meta.url), "utf8");

describe("super-admin pages migrated to TailAdmin", () => {
  for (const p of pages) {
    it(`${p}: no OwnerUi component imports, uses dashboard/ui`, () => {
      const s = read(p);
      expect(s).not.toMatch(
        /Owner(Page|Panel|Field|Notice|Empty|Loading|Retry|Pagination|PageHeader)/,
      );
      expect(s).not.toContain("ownerPrimaryButtonClass");
      expect(s).not.toContain("ownerControlClass");
    });
  }
  it("dashboard index uses TaStatCard", () => {
    expect(read("index")).toContain("TaStatCard");
  });
});
