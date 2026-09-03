import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { decryptPrivateQrExport, encryptPrivateQrExport } from "../src/lib/r2.server";
import { handleOpaqueQrRequest, trustedQrScannerIp } from "../src/lib/dynamic-qr.server";
import { generateQrBatchCore } from "../src/lib/qr-export.server";

const RESTAURANT_ID = "33916a05-7e95-42fa-bc3c-050bed2402c5";
const TOKEN = "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ";
const KEY = Buffer.alloc(32, 7).toString("base64");

const migrationSource = () =>
  readFileSync(
    new URL("../supabase/migrations/20260902090000_dynamic_qr_tokens.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

const r2Source = () => readFileSync(new URL("../src/lib/r2.server.ts", import.meta.url), "utf8");

const exportSource = () =>
  readFileSync(new URL("../src/lib/qr-export.server.ts", import.meta.url), "utf8");

describe("M-01 security remediation", () => {
  it("encrypts QR archives before the public R2 bucket and decrypts only on the authenticated path", () => {
    const plaintext = new TextEncoder().encode(
      "table_number,url\n1,https://qr.example/q/secret-token\n",
    );
    const encrypted = encryptPrivateQrExport(plaintext, KEY);
    expect(Buffer.from(encrypted).includes(Buffer.from("secret-token"))).toBe(false);
    expect(decryptPrivateQrExport(encrypted, KEY)).toEqual(plaintext);
    expect(() =>
      decryptPrivateQrExport(encrypted, Buffer.alloc(32, 8).toString("base64")),
    ).toThrow();

    const source = r2Source();
    expect(source).toContain("QR_EXPORT_ENCRYPTION_KEY");
    expect(source).toContain("encryptPrivateQrExport");
    expect(source).toContain("decryptPrivateQrExport");
    expect(exportSource()).toContain("readPrivateQrExportObject");
  });

  it("trusts only Vercel's canonical scanner header and fails closed without it", async () => {
    const trusted = new Headers({
      "x-vercel-forwarded-for": "203.0.113.8",
      "x-forwarded-for": "198.51.100.9",
      "x-real-ip": "192.0.2.4",
    });
    expect(trustedQrScannerIp(trusted)).toBe("198.51.100.9");
    expect(trustedQrScannerIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.8" }))).toBeNull();

    const resolveAndEnqueue = vi.fn(async () => null);
    const response = await handleOpaqueQrRequest(TOKEN, new Headers(), { resolveAndEnqueue });
    expect(response.status).toBe(404);
    expect(resolveAndEnqueue).not.toHaveBeenCalled();
  });

  it("enforces both 30-second debounce and a ten-scan/ten-minute database rate limit", () => {
    const sql = migrationSource();
    expect(sql).toContain("window_started_at");
    expect(sql).toContain("accepted_scan_count");
    expect(sql).toContain("interval '30 seconds'");
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toMatch(/accepted_scan_count\s*<\s*10/);
  });

  it("removes both uploaded artifacts before retrying a token collision", async () => {
    const order: string[] = [];
    let batch = 0;
    const commit = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("collision"), { code: "23505" }))
      .mockResolvedValueOnce(undefined);

    await generateQrBatchCore(
      {
        restaurantId: RESTAURANT_ID,
        domain: "https://qr.xdirga.xyz",
        scope: "selected",
        tableNumbers: [1],
        createdBy: "super-admin",
      },
      {
        generateBatchId: () => `7359da62-dc98-4a81-9a0f-56da46f32f7${batch++}`,
        generateToken: () => "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ",
        upload: vi.fn(async (key) => {
          order.push(`upload:${key}`);
        }),
        remove: vi.fn(async (key) => {
          order.push(`remove:${key}`);
        }),
        commit: async (input) => {
          order.push(`commit:${input.batchId}`);
          await commit(input);
        },
      },
    );

    const firstBatch = "7359da62-dc98-4a81-9a0f-56da46f32f70";
    const firstCommitIndex = order.indexOf(`commit:${firstBatch}`);
    const secondUploadIndex = order.findIndex(
      (entry) => entry.startsWith("upload:") && entry.includes("32f71"),
    );
    expect(order.slice(firstCommitIndex + 1, secondUploadIndex)).toEqual([
      `remove:qr-exports/${RESTAURANT_ID}/${firstBatch}/qr-codes.xlsx`,
      `remove:qr-exports/${RESTAURANT_ID}/${firstBatch}/qr-codes.csv`,
    ]);
  });

  it("removes a completed XLSX upload when the CSV upload fails", async () => {
    const remove = vi.fn(async (_key: string): Promise<void> => {});
    await expect(
      generateQrBatchCore(
        {
          restaurantId: RESTAURANT_ID,
          domain: "https://qr.xdirga.xyz",
          scope: "selected",
          tableNumbers: [1],
          createdBy: "super-admin",
        },
        {
          generateBatchId: () => "7359da62-dc98-4a81-9a0f-56da46f32f70",
          generateToken: () => "pQGY7kb9ucxOH0-kQtxpjSscP-tZmo4zCvV4kWJpZRQ",
          upload: vi.fn(async (key) => {
            if (key.endsWith(".csv")) throw new Error("CSV upload failed");
          }),
          remove,
          commit: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("CSV upload failed");
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls.map(([key]) => key)).toEqual([
      expect.stringMatching(/\.xlsx$/),
      expect.stringMatching(/\.csv$/),
    ]);
  });
});
