import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = () =>
  readFileSync(new URL("../src/components/CrewHeader.tsx", import.meta.url), "utf8");

describe("CrewHeader compact layout + notice slot", () => {
  it("accepts restaurantCode and notice props", () => {
    const file = source();
    expect(file).toContain("restaurantCode");
    expect(file).toContain("notice");
    expect(file).toContain("formatRestaurantLabel");
  });
  it("renders the magenta notice box and cyan role pill", () => {
    const file = source();
    expect(file).toContain("bg-fuchsia-50");
    expect(file).toContain("bg-cyan-600");
  });
  it("keeps the header sticky", () => {
    expect(source()).toContain("sticky top-0");
  });
  it("shows a placeholder when there is no notice", () => {
    const file = source();
    expect(file).toContain("Belum ada perubahan status meja");
    expect(file).toContain("opacity-60");
    expect(file).not.toContain("Informasi Update Status Meja Akan Muncul Disini Ya");
  });
  it("reserves enough notice height so the layout does not shift when a toast appears", () => {
    expect(source()).toContain("min-h-[3.75rem]");
  });
  it("supports a stacked (two-line) restaurant identity for the manager header", () => {
    const file = source();
    expect(file).toContain("stackedRestaurant");
    expect(file).toContain("restaurantCode");
    expect(file).toContain("restaurantName");
  });
});
