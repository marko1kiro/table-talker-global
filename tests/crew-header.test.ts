import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/CrewHeader.tsx", import.meta.url), "utf8");

describe("CrewTableSection dark", () => {
  it("adds dark variants to the section card + buttons", () => {
    const s = src();
    expect(s).toContain("dark:bg-ta-gray-800");
    expect(s).toContain("dark:border-ta-gray-700");
  });
});
