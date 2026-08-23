import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { computeHash } from "./audio-sync";

const R2_ACCOUNT_ID = process.env.CF_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.CF_R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.CF_R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET = process.env.CF_R2_BUCKET ?? "table-talker-static";
const R2_PUBLIC_BASE = process.env.CF_R2_PUBLIC_URL ?? "https://static.xdirga.xyz";

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

export function r2Key(restaurantId: string, audioId: string, hash: string): string {
  const safeAudio = audioId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `restaurants/${restaurantId}/${safeAudio}/${hash}.mp3`;
}

export async function uploadToR2(
  restaurantId: string,
  audioId: string,
  buffer: ArrayBuffer,
): Promise<{ key: string; url: string; hash: string; byteSize: number } | null> {
  const s3 = getClient();
  if (!s3) return null;

  try {
    const hash = await computeHash(buffer);
    const key = r2Key(restaurantId, audioId, hash);

    // Check if already exists
    try {
      await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      return { key, url: r2PublicUrl(key), hash, byteSize: buffer.byteLength };
    } catch {
      // Not found — proceed with upload
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: new Uint8Array(buffer),
        ContentType: "audio/mpeg",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );

    return { key, url: r2PublicUrl(key), hash, byteSize: buffer.byteLength };
  } catch {
    return null;
  }
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
