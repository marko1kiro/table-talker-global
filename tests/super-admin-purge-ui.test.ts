import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const ui = readFileSync(
  new URL("../src/routes/super-admin/restaurants/$id.tsx", import.meta.url),
  "utf8",
);

describe("super admin restaurant detail purge UI", () => {
  it("imports purgeRestaurantTestData", () => {
    expect(ui).toContain("purgeRestaurantTestData");
  });
  it("has Danger Zone card with clear safety explanation", () => {
    expect(ui).toContain("Reset Data Testing & Operasional");
    expect(ui).toContain("Ketik &apos;RESET&apos;");
  });
  it("requires RESET confirmation text", () => {
    expect(ui).toContain('purgeConfirmation !== "RESET"');
  });
});
