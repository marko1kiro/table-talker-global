import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isOwnerCatalogAudioId } from "./owner-restaurants-domain";

const R2_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.CF_R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET = process.env.CF_R2_BUCKET ?? "soundboard";
const R2_PUBLIC_BASE = process.env.CF_R2_PUBLIC_URL ?? "https://static.lihatmeja.com";
export const R2_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const R2_UPLOAD_MIN_BYTES = 1024;
const R2_UPLOAD_CONTENT_TYPE = "audio/mpeg";
const R2_UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";
const R2_HEALTHCHECK_KEY = "healthcheck";
const QR_EXPORT_MAGIC = Buffer.from("LIMEQR01", "ascii");
const QR_EXPORT_IV_BYTES = 12;
const QR_EXPORT_TAG_BYTES = 16;
const QR_EXPORT_KEY_PATTERN =
  /^qr-exports\/[0-9a-f-]+\/[0-9a-f-]+\/qr-codes\.(xlsx|csv|docx)$/i;

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (client) return client;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;

  client = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  return client;
}

export function r2PublicUrl(key: string): string {
  return `${R2_PUBLIC_BASE}/${key}`;
}

export async function getR2Health(): Promise<{
  status: "healthy" | "unavailable";
  message?: string;
}> {
  const s3 = getClient();
  if (!s3) return { status: "unavailable", message: "R2 belum dikonfigurasi." };
  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: R2_HEALTHCHECK_KEY }));
    return { status: "healthy" };
  } catch (error) {
    if (error instanceof S3ServiceException && error.name === "NotFound")
      return { status: "healthy" };
    return { status: "unavailable", message: "R2 tidak merespons." };
  }
}

export function r2Key(restaurantId: string, audioId: string, hash: string): string {
  const safeAudio = audioId.replace(":", "_");
  return `restaurants/${restaurantId}/${safeAudio}/${hash}.mp3`;
}

export async function readFromR2(key: string): Promise<Uint8Array> {
  const s3 = getClient();
  if (!s3) throw new Error("R2 belum dikonfigurasi.");

  const object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (!object.Body) throw new Error("Objek R2 tidak tersedia.");
  return object.Body.transformToByteArray();
}

function qrExportEncryptionKey(encodedKey = process.env.QR_EXPORT_ENCRYPTION_KEY ?? ""): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("Kunci enkripsi export QR belum dikonfigurasi dengan benar.");
  }
  return key;
}

export function encryptPrivateQrExport(body: Uint8Array | string, encodedKey?: string): Uint8Array {
  const plaintext = typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body);
  const iv = randomBytes(QR_EXPORT_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", qrExportEncryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return new Uint8Array(Buffer.concat([QR_EXPORT_MAGIC, iv, cipher.getAuthTag(), ciphertext]));
}

export function decryptPrivateQrExport(body: Uint8Array, encodedKey?: string): Uint8Array {
  const envelope = Buffer.from(body);
  const headerBytes = QR_EXPORT_MAGIC.byteLength + QR_EXPORT_IV_BYTES + QR_EXPORT_TAG_BYTES;
  if (
    envelope.byteLength < headerBytes ||
    !envelope.subarray(0, QR_EXPORT_MAGIC.byteLength).equals(QR_EXPORT_MAGIC)
  ) {
    throw new Error("Arsip QR terenkripsi tidak valid.");
  }
  const ivStart = QR_EXPORT_MAGIC.byteLength;
  const tagStart = ivStart + QR_EXPORT_IV_BYTES;
  const dataStart = tagStart + QR_EXPORT_TAG_BYTES;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    qrExportEncryptionKey(encodedKey),
    envelope.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(envelope.subarray(tagStart, dataStart));
  return new Uint8Array(
    Buffer.concat([decipher.update(envelope.subarray(dataStart)), decipher.final()]),
  );
}

function validateQrExportKey(key: string): void {
  if (!QR_EXPORT_KEY_PATTERN.test(key)) throw new Error("Key export QR tidak valid.");
}

export async function uploadPrivateR2Object(
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<void> {
  const s3 = getClient();
  if (!s3) throw new Error("R2 belum dikonfigurasi.");
  validateQrExportKey(key);
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: encryptPrivateQrExport(body),
      ContentType: "application/octet-stream",
      CacheControl: "private, no-store",
      Metadata: { "original-content-type": contentType },
    }),
  );
}

export async function readPrivateQrExportObject(key: string): Promise<Uint8Array> {
  const s3 = getClient();
  if (!s3) throw new Error("R2 belum dikonfigurasi.");
  validateQrExportKey(key);
  const object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  if (!object.Body) throw new Error("Objek R2 tidak tersedia.");
  return decryptPrivateQrExport(await object.Body.transformToByteArray());
}

export async function deletePrivateQrExportObject(key: string): Promise<void> {
  const s3 = getClient();
  if (!s3) throw new Error("R2 belum dikonfigurasi.");
  validateQrExportKey(key);
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

type R2UploadRequest = {
  restaurantId: string;
  audioId: string;
  contentType: string;
  byteSize: number;
  contentHash: string;
};

export function validateR2UploadRequest(input: R2UploadRequest): R2UploadRequest {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.restaurantId))
    throw new Error("Restaurant tidak valid.");
  if (!isOwnerCatalogAudioId(input.audioId)) throw new Error("Audio ID tidak valid.");
  if (input.contentType !== R2_UPLOAD_CONTENT_TYPE) throw new Error("File harus MP3.");
  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize < R2_UPLOAD_MIN_BYTES ||
    input.byteSize > R2_UPLOAD_MAX_BYTES
  )
    throw new Error("Ukuran file harus 1 KB-10 MB.");
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) throw new Error("Hash file tidak valid.");
  return input;
}

function hexToBase64(value: string): string {
  return Buffer.from(value, "hex").toString("base64");
}

export async function createPresignedR2Upload(input: R2UploadRequest) {
  const s3 = getClient();
  if (!s3) throw new Error("R2 belum dikonfigurasi.");

  const { restaurantId, audioId, contentHash, byteSize } = validateR2UploadRequest(input);
  const key = r2Key(restaurantId, audioId, contentHash);

  try {
    await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  } catch (error) {
    if (!(error instanceof S3ServiceException && error.name === "NotFound")) throw error;
  }

  const checksum = hexToBase64(contentHash);
  const putUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: R2_UPLOAD_CONTENT_TYPE,
      CacheControl: R2_UPLOAD_CACHE_CONTROL,
      ChecksumSHA256: checksum,
    }),
    { expiresIn: 60 },
  );

  return {
    putUrl,
    key,
    url: r2PublicUrl(key),
    hash: contentHash,
    byteSize,
    headers: {
      "content-type": R2_UPLOAD_CONTENT_TYPE,
      "cache-control": R2_UPLOAD_CACHE_CONTROL,
      "x-amz-checksum-sha256": checksum,
    },
  };
}

export async function verifyR2Upload(input: Omit<R2UploadRequest, "contentType">): Promise<string> {
  const s3 = getClient();
  if (!s3) throw new Error("R2 belum dikonfigurasi.");

  const { restaurantId, audioId, contentHash, byteSize } = validateR2UploadRequest({
    ...input,
    contentType: R2_UPLOAD_CONTENT_TYPE,
  });
  const key = r2Key(restaurantId, audioId, contentHash);
  const object = await s3.send(
    new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key, ChecksumMode: "ENABLED" }),
  );
  if (
    object.ContentLength !== byteSize ||
    object.ChecksumSHA256 !== hexToBase64(contentHash) ||
    object.ContentType !== R2_UPLOAD_CONTENT_TYPE ||
    object.CacheControl !== R2_UPLOAD_CACHE_CONTROL
  ) {
    await deleteFromR2(key);
    throw new Error("Objek R2 tidak sesuai metadata upload.");
  }
  return key;
}

export async function deleteFromR2(key: string): Promise<boolean> {
  const s3 = getClient();
  if (!s3) return false;

  try {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}
