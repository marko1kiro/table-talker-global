import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret } from "./auth.server";

const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 12;
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

type TenantSessionPayload = { restaurantId: string; expiresAt: number };

function encode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string) {
  return createHmac("sha256", getAuthSecret()).update(payload).digest("base64url");
}

export function verifyRestaurantPin(pin: string, pinHash: string | null): boolean {
  if (!pinHash || !/^[a-f0-9]{64}$/i.test(pinHash)) return false;
  const expected = Buffer.from(pinHash, "hex");
  const candidate = createHash("sha256").update(pin).digest();
  return timingSafeEqual(candidate, expected);
}

export function isTenantLoginRateLimited(key: string, now = Date.now()): boolean {
  const attempt = attempts.get(key);
  return Boolean(attempt && attempt.resetAt > now && attempt.count >= MAX_ATTEMPTS);
}

export function recordTenantLoginFailure(key: string, now = Date.now()) {
  const previous = attempts.get(key);
  const attempt = !previous || previous.resetAt <= now
    ? { count: 1, resetAt: now + ATTEMPT_WINDOW_MS }
    : { ...previous, count: previous.count + 1 };
  attempts.set(key, attempt);
}

export function clearTenantLoginFailures(key: string) {
  attempts.delete(key);
}

export function createTenantSession(restaurantId: string, now = Date.now()): string {
  const payload = encode(JSON.stringify({ restaurantId, expiresAt: now + TOKEN_MAX_AGE_SECONDS * 1000 }));
  return `${payload}.${sign(payload)}`;
}

export function verifyTenantSession(token: string, now = Date.now()): TenantSessionPayload | null {
  const [payload, signature, ...extra] = token.split(".");
  if (!payload || !signature || extra.length) return null;
  const expected = sign(payload);
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TenantSessionPayload;
    return typeof value.restaurantId === "string" && Number.isFinite(value.expiresAt) && value.expiresAt > now
      ? value
      : null;
  } catch {
    return null;
  }
}
