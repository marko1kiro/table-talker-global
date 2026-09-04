import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = () =>
  readFileSync(new URL("../src/components/dashboard/ui.tsx", import.meta.url), "utf8");

describe("dashboard/ui primitives", () => {
  it("exports the OwnerUi-mirror set + stat card", () => {
    const s = src();
    for (const name of [
      "TaPage",
      "TaPageHeader",
      "TaCard",
      "TaField",
      "TaNotice",
      "TaEmpty",
      "TaLoading",
      "TaRetry",
      "TaPagination",
      "TaBadge",
      "TaStatCard",
      "taControlClass",
      "taPrimaryButtonClass",
      "taSecondaryButtonClass",
      "taDangerButtonClass",
    ]) {
      expect(s).toContain(name);
    }
  });
  it("uses brand + ta-gray tokens, not amber", () => {
    const s = src();
    expect(s).toContain("bg-brand-500");
    expect(s).toContain("border-ta-gray-200");
    expect(s).not.toContain("amber");
  });
  it("primitives carry dark-mode variants", () => {
    const s = src();
    expect(s).toContain("dark:bg-ta-gray-800");
    expect(s).toContain("dark:border-ta-gray-700");
    expect(s).toContain("dark:text-white");
    expect(s).toContain("dark:bg-ta-gray-900");
  });
});
