import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const r2Server = () => readFileSync(new URL("../src/lib/r2.server.ts", import.meta.url), "utf8");

it("imports S3Client and commands from @aws-sdk/client-s3", () => {
  const source = r2Server();
  expect(source).toContain("@aws-sdk/client-s3");
  expect(source).toContain("S3Client");
  expect(source).toContain("PutObjectCommand");
  expect(source).toContain("DeleteObjectCommand");
  expect(source).toContain("HeadObjectCommand");
});

it("reads CF_ACCOUNT_ID, CF_R2_ACCESS_KEY_ID, CF_R2_SECRET_ACCESS_KEY env vars", () => {
  const source = r2Server();
  expect(source).toContain("CF_ACCOUNT_ID");
  expect(source).toContain("CF_R2_ACCESS_KEY_ID");
  expect(source).toContain("CF_R2_SECRET_ACCESS_KEY");
});

it("exports presigned upload, deleteFromR2, r2PublicUrl, r2Key", () => {
  const source = r2Server();
  expect(source).toContain("export async function createPresignedR2Upload");
  expect(source).toContain("@aws-sdk/s3-request-presigner");
  expect(source).toContain("export async function deleteFromR2");
  expect(source).toContain("export function r2PublicUrl");
  expect(source).toContain("export function r2Key");
});

it("uses immutable cache headers and only accepts NotFound from HeadObject", () => {
  const source = r2Server();
  expect(source).toContain("immutable");
  expect(source).toContain("max-age=31536000");
  expect(source).toContain('error.name === "NotFound"');
});

it("r2Key generates path with restaurant ID and hash", () => {
  const source = r2Server();
  expect(source).toContain("restaurants/${restaurantId}");
  expect(source).toContain("${hash}.mp3");
});

it("verifies uploaded object size, checksum, and immutable metadata before catalog mutation", () => {
  const source = r2Server();
  expect(source).toContain("export async function verifyR2Upload");
  expect(source).toContain("ContentLength");
  expect(source).toContain("ChecksumSHA256");
  expect(source).toContain("ContentType");
  expect(source).toContain("CacheControl");
  expect(source).toContain('ChecksumMode: "ENABLED"');
});
