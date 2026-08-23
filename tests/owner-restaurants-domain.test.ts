import { expect, it } from "vitest";
import { validateCatalogItem } from "../src/lib/owner-restaurants-domain";

const table = { audioId: "table:100", label: "Meja 100", category: "BASE" };

it("accepts owner table catalog IDs from 1 through 100", () => {
  expect(validateCatalogItem(table)).toEqual(table);
  expect(validateCatalogItem({ ...table, audioId: "table:1" })).toEqual({
    ...table,
    audioId: "table:1",
  });
});

it("rejects table catalog IDs outside 1 through 100", () => {
  expect(validateCatalogItem({ ...table, audioId: "table:0" })).toEqual({
    code: "INVALID_AUDIO_ID",
  });
  expect(validateCatalogItem({ ...table, audioId: "table:101" })).toEqual({
    code: "INVALID_AUDIO_ID",
  });
});

it("accepts only current announcement IDs", () => {
  expect(
    validateCatalogItem({ ...table, audioId: "announcement:seating", category: "INFO" }),
  ).toEqual({
    ...table,
    audioId: "announcement:seating",
    category: "INFO",
  });
  expect(
    validateCatalogItem({ ...table, audioId: "announcement:unknown", category: "INFO" }),
  ).toEqual({
    code: "INVALID_AUDIO_ID",
  });
});

it("accepts lower-case custom IDs with underscores and hyphens", () => {
  expect(
    validateCatalogItem({ ...table, audioId: "custom:promo_malam-1", category: "CUSTOM" }),
  ).toEqual({
    ...table,
    audioId: "custom:promo_malam-1",
    category: "CUSTOM",
  });
  expect(validateCatalogItem({ ...table, audioId: "custom:Promo", category: "CUSTOM" })).toEqual({
    code: "INVALID_AUDIO_ID",
  });
});
