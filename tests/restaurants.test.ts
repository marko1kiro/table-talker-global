import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL(
    "../supabase/migrations/20260823120000_remove_legacy_restaurant_code.sql",
    import.meta.url,
  ),
  "utf8",
);

it("removes public code lookup semantics from final schema", () => {
  expect(migrationSource).toMatch(/drop index if exists public\.restaurants_code_key/i);
  expect(migrationSource).toMatch(/drop column code/i);
  expect(migrationSource).not.toMatch(/lower\(code\)|ilike/i);
});

import { describe } from "vitest";
import { validateRestaurantCode } from "../src/lib/restaurant-domain";

describe("validateRestaurantCode", () => {
  it("accepts exact uppercase alphanumeric codes", () => {
    expect(validateRestaurantCode("KAMPUNG123")).toEqual({ code: "KAMPUNG123" });
  });

  it("rejects transformed, malformed, and out-of-range codes", () => {
    for (const value of [" kampung123", "kampung123", "ABCDE", "A".repeat(33), "ABC-123"]) {
      expect(validateRestaurantCode(value)).toEqual({ error: "Kode Resto salah." });
    }
  });
});
