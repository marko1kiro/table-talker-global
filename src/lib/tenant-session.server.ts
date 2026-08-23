import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getAuthSecret } from "./auth.server";

const TOKEN_MAX_AGE_SECONDS = 60 * 60;

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
  const candidate = Buffer.from(hashRestaurantPin(pin), "hex");
  return timingSafeEqual(candidate, expected);
}

export function hashRestaurantPin(pin: string): string {
  return createHash("sha256").update(pin).digest("hex");
}

export function hashTenantSession(token: string): string {
  return createHash("sha256").update(token).digest("hex");
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

export async function verifyActiveTenantSession(client: any, token: string) {
  const tenant = verifyTenantSession(token);
  if (!tenant) return null;
  const { data, error } = await client
    .from("restaurant_access_tokens")
    .select("restaurant_id, restaurants!inner(is_active)")
    .eq("token_hash", hashTenantSession(token))
    .eq("restaurant_id", tenant.restaurantId)
    .gt("expires_at", new Date().toISOString())
    .eq("is_active", true)
    .maybeSingle();
  return error || !data ? null : tenant;
}

export async function verifyCrewSessionToken(client: any, token: string, restaurantId: string) {
  const { data, error } = await client
    .from("crew_session_tokens")
    .select("crew_session_id, restaurants!inner(is_active)")
    .eq("token_hash", hashTenantSession(token))
    .eq("restaurant_id", restaurantId)
    .gt("expires_at", new Date().toISOString())
    .eq("is_active", true)
    .maybeSingle();
  return error || !data ? null : { crewSessionId: data.crew_session_id as string };
}
