import { describe, expect, it } from "vitest";
import {
  buildDynamicQrExportDocxBuffer,
  sortQrRowsAscending,
} from "../src/lib/qr-docx.server";

const DOMAIN = "https://qris-order.lihatmeja.com";
const TOKEN = "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ";

describe("QR DOCX builder", () => {
  it("sorts rows ascending by table number without mutating the input", () => {
    const input = [
      { tableNumber: 30, token: TOKEN },
      { tableNumber: 1, token: TOKEN },
      { tableNumber: 6, token: TOKEN },
    ];
    expect(sortQrRowsAscending(input).map((r) => r.tableNumber)).toEqual([1, 6, 30]);
    expect(input.map((r) => r.tableNumber)).toEqual([30, 1, 6]);
  });

  it("renders a non-contiguous subset as a valid docx (zip) buffer", async () => {
    const buffer = await buildDynamicQrExportDocxBuffer(
      [
        { tableNumber: 30, token: TOKEN },
        { tableNumber: 1, token: TOKEN },
        { tableNumber: 6, token: TOKEN },
      ],
      DOMAIN,
    );
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.byteLength).toBeGreaterThan(0);
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });

  it("renders a single-table batch without error", async () => {
    const buffer = await buildDynamicQrExportDocxBuffer(
      [{ tableNumber: 1, token: TOKEN }],
      DOMAIN,
    );
    expect(buffer.subarray(0, 2).toString("latin1")).toBe("PK");
  });
});
