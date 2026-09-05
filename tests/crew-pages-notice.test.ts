import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = ["kasir", "satgas", "clear-up"];

describe("crew pages wire the notification center via CrewShell", () => {
  for (const page of pages) {
    it(`${page} uses CrewShell + useNotificationCenter + feed`, () => {
      const file = readFileSync(
        new URL(`../src/routes/${page}/index.tsx`, import.meta.url),
        "utf8",
      );
      expect(file).toContain("CrewShell");
      expect(file).toContain("useNotificationCenter");
      expect(file).toContain("feed={items}");
      expect(file).toContain("formatOccupancyNotice");
    });
  }
});
