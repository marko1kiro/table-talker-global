import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { r2Key, validateR2UploadRequest } from "../src/lib/r2.server";

const restaurantId = "9552f3b0-7efb-4d8a-9df4-8914bcdb9720";
const hash = "a".repeat(64);

describe("R2 direct upload requests", () => {
  it("accepts bounded MP3 metadata and creates hash-immutable key", () => {
    expect(
      validateR2UploadRequest({
        restaurantId,
        audioId: "table:100",
        contentType: "audio/mpeg",
        byteSize: 10 * 1024 * 1024,
        contentHash: hash,
      }),
    ).toEqual({
      restaurantId,
      audioId: "table:100",
      contentType: "audio/mpeg",
      byteSize: 10 * 1024 * 1024,
      contentHash: hash,
    });
    expect(r2Key(restaurantId, "table:100", hash)).toBe(
      `restaurants/${restaurantId}/table_100/${hash}.mp3`,
    );
  });

  it.each([
    ["table number outside allowed range", { audioId: "table:101" }],
    ["unsafe custom ID", { audioId: "custom:../secret" }],
    ["unknown announcement", { audioId: "announcement:unknown" }],
    ["wrong MIME", { contentType: "audio/mp3" }],
    ["oversize payload", { byteSize: 10 * 1024 * 1024 + 1 }],
    ["uppercase hash", { contentHash: "A".repeat(64) }],
  ])("rejects %s", (_name, override) => {
    expect(() =>
      validateR2UploadRequest({
        restaurantId,
        audioId: "table:1",
        contentType: "audio/mpeg",
        byteSize: 1,
        contentHash: hash,
        ...override,
      }),
    ).toThrow();
  });

  it("verifies upload before catalog mutation and cleans failed objects", () => {
    const source = readFileSync(new URL("../src/lib/manifest.server.ts", import.meta.url), "utf8");
    expect(source).toContain("verifyR2Upload");
    expect(source).toContain("deleteFromR2");
    expect(source.indexOf("verifyR2Upload")).toBeLessThan(source.indexOf("mutate_catalog"));
  });
});
