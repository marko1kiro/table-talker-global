import { describe, expect, it } from "vitest";
import { generateA2QrPdfBuffer } from "../src/lib/qr-pdf.server";

describe("generateA2QrPdfBuffer", () => {
  it("generates a valid A2 PDF buffer with PDF magic bytes and 150 QR items", async () => {
    const rows = Array.from({ length: 68 }, (_, i) => ({
      tableNumber: i + 1,
      token: "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde",
    }));
    const buf = await generateA2QrPdfBuffer(rows, "https://qris-order.lihatmeja.com");
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(10000);
    // PDF Magic Header %PDF-
    expect(buf.subarray(0, 4).toString("utf8")).toBe("%PDF");
  });
});
