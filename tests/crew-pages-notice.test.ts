import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = ["kasir", "satgas", "clear-up"];

describe("crew pages wire the notification center", () => {
  for (const page of pages) {
    it(`${page} uses useNotificationCenter + feed`, () => {
      const file = readFileSync(
        new URL(`../src/routes/${page}/index.tsx`, import.meta.url),
        "utf8",
      );
      expect(file).toContain("useNotificationCenter");
      expect(file).toContain("unread");
      expect(file).toContain("formatOccupancyNotice");
    });
  }
});
