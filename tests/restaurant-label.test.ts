import { describe, expect, it } from "vitest";
import { formatRestaurantLabel } from "../src/lib/restaurant-label";

describe("formatRestaurantLabel", () => {
  it("prefixes the code and strips the chain brand", () => {
    expect(formatRestaurantLabel("CKRBUL", "Mie Gacoan Kampung Bulu")).toBe(
      "CKRBUL - Kampung Bulu",
    );
  });
  it("omits the code separator when no code", () => {
    expect(formatRestaurantLabel("", "Mie Gacoan Kampung Bulu")).toBe("Kampung Bulu");
  });
  it("keeps a name that does not start with the brand", () => {
    expect(formatRestaurantLabel("ABC", "Warung Nusantara")).toBe("ABC - Warung Nusantara");
  });
  it("falls back to the full name when stripping empties it", () => {
    expect(formatRestaurantLabel("MG", "Mie Gacoan")).toBe("MG - Mie Gacoan");
  });
});
