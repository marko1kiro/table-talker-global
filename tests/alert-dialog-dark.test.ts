import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/ui/alert-dialog.tsx", import.meta.url), "utf8");

describe("alert-dialog dark", () => {
  it("has dark variants", () => {
    expect(src()).toContain("dark:");
  });
});
