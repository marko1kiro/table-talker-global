import { createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret } from "./auth.server";

const GRANT_TTL_MS = 10 * 60 * 1000;

type AudioDownloadGrant = {
  version: 1;
  restaurantId: string;
  audioId: string;
  contentHash: string;
  byteSize: number;
  expiresAt: number;
};

function signature(payload: string): Buffer {
  return createHmac("sha256", getAuthSecret()).update(payload).digest();
}

export function createAudioDownloadGrant(
  input: Omit<AudioDownloadGrant, "version" | "expiresAt">,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...input, version: 1, expiresAt: now + GRANT_TTL_MS }),
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function verifyAudioDownloadGrant(
  token: string,
  now = Date.now(),
): AudioDownloadGrant | null {
  const [payload, encodedSignature, extra] = token.split(".");
  if (!payload || !encodedSignature || extra) return null;

  try {
    const received = Buffer.from(encodedSignature, "base64url");
    const expected = signature(payload);
    if (received.byteLength !== expected.byteLength || !timingSafeEqual(received, expected))
      return null;

    const grant = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<AudioDownloadGrant>;
    if (
      grant.version !== 1 ||
      typeof grant.restaurantId !== "string" ||
      typeof grant.audioId !== "string" ||
      typeof grant.contentHash !== "string" ||
      !/^[0-9a-f]{64}$/.test(grant.contentHash) ||
      !Number.isInteger(grant.byteSize) ||
      (grant.byteSize ?? 0) <= 0 ||
      !Number.isFinite(grant.expiresAt) ||
      (grant.expiresAt ?? 0) <= now ||
      (grant.expiresAt ?? 0) > now + GRANT_TTL_MS
    )
      return null;

    return grant as AudioDownloadGrant;
  } catch {
    return null;
  }
}
