import { expect, it } from "vitest";
import { validateCatalogItem, validateCatalogMutation } from "../src/lib/owner-restaurants-domain";

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

it("accepts every current announcement ID", () => {
  for (const id of [
    "seating",
    "himbauan-barang-bawaan-pelanggan",
    "jam-buka-resto",
    "outside-food",
    "no-smoking",
    "larangan-gabung-meja",
  ])
    expect(
      validateCatalogItem({ ...table, audioId: `announcement:${id}`, category: "INFO" }),
    ).toMatchObject({ audioId: `announcement:${id}` });
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

it("rejects invalid mutation metadata, size, hashes, and ordering", () => {
  expect(
    validateCatalogMutation({
      ...table,
      r2Url: "https://static.example/audio.mp3",
      contentHash: "a".repeat(64),
      byteSize: 1024 * 1024,
      ordering: 0,
    }),
  ).toMatchObject({ ok: true });
  expect(
    validateCatalogMutation({
      ...table,
      r2Url: "bad",
      contentHash: "a".repeat(64),
      byteSize: 1024 * 1024,
      ordering: 0,
    }),
  ).toMatchObject({ code: "INVALID_METADATA" });
  expect(
    validateCatalogMutation({
      ...table,
      r2Url: "https://static.example/audio.mp3",
      contentHash: "a".repeat(63),
      byteSize: 1024 * 1024,
      ordering: 0,
    }),
  ).toMatchObject({ code: "INVALID_METADATA" });
  expect(
    validateCatalogMutation({
      ...table,
      r2Url: "https://static.example/audio.mp3",
      contentHash: "a".repeat(64),
      byteSize: 1023,
      ordering: 0,
    }),
  ).toMatchObject({ code: "INVALID_METADATA" });
  expect(
    validateCatalogMutation({
      ...table,
      r2Url: "https://static.example/audio.mp3",
      contentHash: "a".repeat(64),
      byteSize: 1024,
      ordering: 0,
    }),
  ).toMatchObject({ ok: true });
  expect(
    validateCatalogMutation({
      ...table,
      r2Url: "https://static.example/audio.mp3",
      contentHash: "a".repeat(64),
      byteSize: 1024 * 1024,
      ordering: -1,
    }),
  ).toMatchObject({ code: "INVALID_METADATA" });
});

it("trims category before storing catalog metadata", () => {
  expect(validateCatalogItem({ ...table, category: "  BASE  " })).toMatchObject({
    category: "BASE",
  });
  expect(
    validateCatalogMutation({
      ...table,
      label: "  Meja 100  ",
      category: "  BASE  ",
      r2Url: "https://static.example/audio.mp3",
      contentHash: "a".repeat(64),
      byteSize: 1024 * 1024,
      ordering: 0,
    }),
  ).toMatchObject({ ok: true, item: { label: "Meja 100", category: "BASE" } });
});
