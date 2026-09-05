import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () => readFileSync(new URL("../src/components/OwnerUi.tsx", import.meta.url), "utf8");

describe("OwnerUi dark", () => {
  it("adds dark variants to surfaces and tones", () => {
    const s = src();
    expect(s).toContain("dark:bg-ta-gray-800");
    expect(s).toContain("dark:border-ta-gray-700");
    expect(s).toContain("dark:text-ta-gray-100");
    expect(s).toContain("dark:text-ta-gray-400");
  });
});
