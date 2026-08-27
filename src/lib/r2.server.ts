import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ANNOUNCEMENT_CATALOG } from "./remote-audio-domain";

const R2_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.CF_R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET = process.env.CF_R2_BUCKET ?? "soundboard";
const R2_PUBLIC_BASE = process.env.CF_R2_PUBLIC_URL ?? "https://static.xdirga.xyz";
export const R2_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const R2_UPLOAD_MIN_BYTES = 1024 * 1024;
const R2_UPLOAD_CONTENT_TYPE = "audio/mpeg";
const R2_UPLOAD_CACHE_CONTROL = "public, max-age=31536000, immutable";
const R2_HEALTHCHECK_KEY = "healthcheck";

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
  if (!object.Body) throw new Error("Objek audio tidak tersedia.");
  return object.Body.transformToByteArray();
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
  if (!isAllowedAudioId(input.audioId)) throw new Error("Audio ID tidak valid.");
  if (input.contentType !== R2_UPLOAD_CONTENT_TYPE) throw new Error("File harus MP3.");
  if (
    !Number.isInteger(input.byteSize) ||
    input.byteSize < R2_UPLOAD_MIN_BYTES ||
    input.byteSize > R2_UPLOAD_MAX_BYTES
  )
    throw new Error("Ukuran file harus 1-10 MB.");
  if (!/^[0-9a-f]{64}$/.test(input.contentHash)) throw new Error("Hash file tidak valid.");
  return input;
}

function isAllowedAudioId(audioId: string): boolean {
  if (/^table:(?:[1-9]|[1-9][0-9]|100)$/.test(audioId)) return true;
  if (ANNOUNCEMENT_CATALOG.some((item) => audioId === `announcement:${item.id}`)) return true;
  return /^custom:[a-z0-9][a-z0-9_-]{0,99}$/.test(audioId);
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
