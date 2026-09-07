import { describe, expect, it } from "vitest";
import {
  generateQrBatchCore,
  qrExportKey,
  type CommitQrBatchInput,
} from "../src/lib/qr-export.server";

const RESTAURANT_ID = "00000000-0000-0000-0000-000000000001";
const BATCH_ID = "11111111-1111-1111-1111-111111111111";
const DOMAIN = "https://qris-order.lihatmeja.com";

describe("generateQrBatchCore for A2 PDF", () => {
  it("formats the R2 storage key for pdf", () => {
    expect(qrExportKey(RESTAURANT_ID, BATCH_ID, "pdf")).toBe(
      `qr-exports/${RESTAURANT_ID}/${BATCH_ID}/qr-codes.pdf`,
    );
  });

  it("uploads PDF artifact and commits to database with r2KeyPdf", async () => {
    const uploaded: { key: string; contentType: string; bytes: number }[] = [];
    let committed: CommitQrBatchInput | null = null;

    const result = await generateQrBatchCore(
      {
        restaurantId: RESTAURANT_ID,
        domain: DOMAIN,
        scope: "selected",
        tableNumbers: Array.from({ length: 68 }, (_, i) => i + 1),
        createdBy: "super-admin",
      },
      {
        generateBatchId: () => BATCH_ID,
        generateToken: (n) => `token_${String(n).padStart(2, "0")}_abcdefghijklmnopqrstuvwxyz`,
        upload: async (key, body, contentType) => {
          uploaded.push({ key, contentType, bytes: body.length });
        },
        remove: async () => {},
        commit: async (input) => {
          committed = input;
        },
      },
    );

    expect(result.batchId).toBe(BATCH_ID);
    expect(result.r2KeyPdf).toBe(`qr-exports/${RESTAURANT_ID}/${BATCH_ID}/qr-codes.pdf`);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0].key).toBe(`qr-exports/${RESTAURANT_ID}/${BATCH_ID}/qr-codes.pdf`);
    expect(uploaded[0].contentType).toBe("application/pdf");
    expect(uploaded[0].bytes).toBeGreaterThan(5000);

    expect(committed).not.toBeNull();
    expect(committed?.tableNumbers).toHaveLength(68);
  }, 15000);
});
