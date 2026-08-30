import { describe, expect, it } from "vitest";
import { buildQrExportRows } from "../src/lib/qr-export-domain";
import { TABLE_COUNT } from "../src/lib/remote-audio-domain";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const DOMAIN = "https://qr.xdirga.xyz";

describe("buildQrExportRows", () => {
  it("always returns exactly TABLE_COUNT (100) rows, regardless of restaurant", () => {
    const rows = buildQrExportRows(RESTAURANT_ID, DOMAIN);
    expect(rows).toHaveLength(TABLE_COUNT);
    expect(rows).toHaveLength(100);
  });

  it("numbers tables 1 through 100 in order, with no gaps or duplicates", () => {
    const rows = buildQrExportRows(RESTAURANT_ID, DOMAIN);
    expect(rows.map((row) => row.tableNumber)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
  });

  it("builds the interceptor URL shape {domain}/r/{restaurantId}/t/{n} for each row", () => {
    const rows = buildQrExportRows(RESTAURANT_ID, DOMAIN);
    expect(rows[0]).toEqual({
      tableNumber: 1,
      url: `https://qr.xdirga.xyz/r/${RESTAURANT_ID}/t/1`,
    });
    expect(rows[99]).toEqual({
      tableNumber: 100,
      url: `https://qr.xdirga.xyz/r/${RESTAURANT_ID}/t/100`,
    });
  });

  it("substitutes whatever domain is passed in, not a hardcoded one", () => {
    const rows = buildQrExportRows(RESTAURANT_ID, "https://example-domain.test");
    expect(rows[6].url).toBe(`https://example-domain.test/r/${RESTAURANT_ID}/t/7`);
  });

  it("strips a trailing slash from the domain before building URLs", () => {
    const rows = buildQrExportRows(RESTAURANT_ID, "https://qr.xdirga.xyz/");
    expect(rows[0].url).toBe(`https://qr.xdirga.xyz/r/${RESTAURANT_ID}/t/1`);
  });

  it("uses a different restaurant id correctly", () => {
    const otherId = "d2705dec-1dd6-48f2-9f36-870af1cbd947";
    const rows = buildQrExportRows(otherId, DOMAIN);
    expect(rows[49].url).toBe(`https://qr.xdirga.xyz/r/${otherId}/t/50`);
  });
});
