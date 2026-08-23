import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const migrationSource = readFileSync(
  new URL("../supabase/migrations/20260822000000_restaurants.sql", import.meta.url),
  "utf8",
);

it("creates tenant table with case-insensitive unique codes and audit fields", () => {
  expect(migrationSource).toMatch(/create table public\.restaurants \(/i);
  expect(migrationSource).toMatch(
    /create unique index restaurants_code_key on public\.restaurants \(lower\(code\)\)/i,
  );
  expect(migrationSource).toMatch(/is_active boolean not null default true/i);
  expect(migrationSource).toMatch(/deactivated_reason text/i);
  expect(migrationSource).toMatch(/catalog_version integer not null default 1/i);
});

it("denies anon and authenticated access and enables RLS", () => {
  expect(migrationSource).toMatch(/enable row level security/i);
  expect(migrationSource).toMatch(/revoke all on public\.restaurants from anon, authenticated/i);
});

it("backfills the pilot restaurant exactly once", () => {
  expect(migrationSource).toMatch(
    /insert into public\.restaurants \(code, display_name\)\s*values \('KAMPUNG-BULU', 'Mie Gacoan Kampung Bulu'\)\s*on conflict \(lower\(code\)\) do nothing;/i,
  );
});

import { describe } from "vitest";
import {
  normalizeRestaurantCode,
} from "../src/lib/restaurant-domain";

describe("normalizeRestaurantCode", () => {
  it("trims and uppercases valid codes", () => {
    expect(normalizeRestaurantCode(" kampung-bulu ")).toEqual({ code: "KAMPUNG-BULU" });
  });

  it("rejects empty, short, long, and invalid-character codes", () => {
    expect(normalizeRestaurantCode("")).toEqual({ error: "Kode resto wajib diisi." });
    expect(normalizeRestaurantCode("ab")).toEqual({
      error: "Kode resto 3\u201332 karakter, huruf/angka/-/_ saja.",
    });
    expect(normalizeRestaurantCode("A".repeat(33))).toEqual({
      error: "Kode resto 3\u201332 karakter, huruf/angka/-/_ saja.",
    });
    expect(normalizeRestaurantCode("BAD CODE!")).toEqual({
      error: "Kode resto 3\u201332 karakter, huruf/angka/-/_ saja.",
    });
  });
});
