import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pages = ["kasir", "satgas", "clear-up"];

describe("crew pages wire notices + restaurant code", () => {
  for (const page of pages) {
    it(`${page} passes restaurantCode + notice and uses the queue`, () => {
      const file = readFileSync(new URL(`../src/routes/${page}/index.tsx`, import.meta.url), "utf8");
      expect(file).toContain("useNoticeQueue");
      expect(file).toContain("restaurantCode={identity.restaurantCode}");
      expect(file).toContain("notice={notices.current}");
      expect(file).toContain("formatOccupancyNotice");
    });
  }
});
