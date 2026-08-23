import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const r2Server = () =>
  readFileSync(new URL("../src/lib/r2.server.ts", import.meta.url), "utf8");

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

it("exports uploadToR2, deleteFromR2, r2PublicUrl, r2Key", () => {
  const source = r2Server();
  expect(source).toContain("export async function uploadToR2");
  expect(source).toContain("export async function deleteFromR2");
  expect(source).toContain("export function r2PublicUrl");
  expect(source).toContain("export function r2Key");
});

it("uses immutable cache headers for R2 uploads", () => {
  const source = r2Server();
  expect(source).toContain("immutable");
  expect(source).toContain("max-age=31536000");
});

it("r2Key generates path with restaurant ID and hash", () => {
  const source = r2Server();
  expect(source).toContain("restaurants/${restaurantId}");
  expect(source).toContain("${hash}.mp3");
});
