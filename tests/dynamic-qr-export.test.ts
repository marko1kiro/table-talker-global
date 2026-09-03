import { describe, expect, it, vi } from "vitest";
import {
  buildDynamicQrExportCsv,
  generateQrBatchCore,
  normalizeQrGenerationSelection,
  qrExportKey,
} from "../src/lib/qr-export.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const BATCH_ID = "7359da62-dc98-4a81-9a0f-56da46f32f70";
const DOMAIN = "https://qr.xdirga.xyz/";

describe("M-01 QR generation and export", () => {
  it("normalizes all or selected table scope and rejects empty/out-of-range selection", () => {
    expect(normalizeQrGenerationSelection("all", [])).toEqual(
      Array.from({ length: 100 }, (_, i) => i + 1),
    );
    expect(normalizeQrGenerationSelection("selected", [9, 2, 9])).toEqual([2, 9]);
    expect(() => normalizeQrGenerationSelection("selected", [])).toThrow();
    expect(() => normalizeQrGenerationSelection("selected", [0, 101])).toThrow();
  });

  it("exports only generated tables using opaque /q/{token} links", () => {
    const csv = buildDynamicQrExportCsv(
      [
        { tableNumber: 2, token: "token-two" },
        { tableNumber: 9, token: "token-nine" },
      ],
      DOMAIN,
    );
    expect(csv.trim().split("\n")).toEqual([
      "table_number,url",
      "2,https://qr.xdirga.xyz/q/token-two",
      "9,https://qr.xdirga.xyz/q/token-nine",
    ]);
    expect(csv).not.toContain(RESTAURANT_ID);
  });

  it("uses the agreed deterministic private R2 keys", () => {
    expect(qrExportKey(RESTAURANT_ID, BATCH_ID, "xlsx")).toBe(
      `qr-exports/${RESTAURANT_ID}/${BATCH_ID}/qr-codes.xlsx`,
    );
    expect(qrExportKey(RESTAURANT_ID, BATCH_ID, "docx")).toBe(
      `qr-exports/${RESTAURANT_ID}/${BATCH_ID}/qr-codes.docx`,
    );
  });

  it("uploads both files before atomically committing token replacement", async () => {
    const order: string[] = [];
    const upload = vi.fn(async (key: string) => {
      order.push(`upload:${key.endsWith(".xlsx") ? "xlsx" : "docx"}`);
    });
    const commit = vi.fn(async () => {
      order.push("commit");
    });
    const result = await generateQrBatchCore(
      {
        restaurantId: RESTAURANT_ID,
        domain: DOMAIN,
        scope: "selected",
        tableNumbers: [2, 9],
        createdBy: "super-admin",
      },
      {
        generateBatchId: () => BATCH_ID,
        generateToken: (table) => `opaque-token-${table}`,
        upload,
        commit,
      },
    );
    expect(order).toEqual(["upload:xlsx", "upload:docx", "commit"]);
    expect(result.tableNumbers).toEqual([2, 9]);
    expect(result.batchId).toBe(BATCH_ID);
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: BATCH_ID,
        tableNumbers: [2, 9],
        tokens: ["opaque-token-2", "opaque-token-9"],
      }),
    );
  });

  it("leaves active database tokens untouched when either R2 upload fails", async () => {
    const commit = vi.fn(async () => {});
    await expect(
      generateQrBatchCore(
        {
          restaurantId: RESTAURANT_ID,
          domain: DOMAIN,
          scope: "selected",
          tableNumbers: [5],
          createdBy: "super-admin",
        },
        {
          generateBatchId: () => BATCH_ID,
          generateToken: () => "opaque-token",
          upload: vi.fn(async (key: string) => {
            if (key.endsWith(".docx")) throw new Error("R2 unavailable");
          }),
          remove: vi.fn(async () => {}),
          commit,
        },
      ),
    ).rejects.toThrow("R2 unavailable");
    expect(commit).not.toHaveBeenCalled();
  });

  it("generates 32-byte base64url tokens and retries a collision as one whole batch", async () => {
    const commits = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("duplicate"), { code: "23505" }))
      .mockResolvedValueOnce(undefined);
    const result = await generateQrBatchCore(
      {
        restaurantId: RESTAURANT_ID,
        domain: DOMAIN,
        scope: "selected",
        tableNumbers: [5],
        createdBy: "super-admin",
      },
      {
        upload: vi.fn(async () => {}),
        remove: vi.fn(async () => {}),
        commit: commits,
      },
    );
    expect(result.tokens[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(commits).toHaveBeenCalledTimes(2);
  });
});
