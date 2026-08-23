import { createHash, randomBytes } from "node:crypto";

export function createOpaqueRestaurantToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueRestaurantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function verifyActiveTenantSession(client: any, token: string) {
  const { data, error } = await client
    .from("restaurant_access_tokens")
    .select("restaurant_id, code_version, restaurants!inner(is_active, code_version)")
    .eq("token_hash", hashOpaqueRestaurantToken(token))
    .gt("expires_at", new Date().toISOString())
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data || data.code_version !== data.restaurants.code_version) return null;
  return { restaurantId: data.restaurant_id as string, codeVersion: data.code_version as number };
}

export async function verifyCrewSessionToken(client: any, token: string, restaurantId: string) {
  const { data, error } = await client
    .from("crew_session_tokens")
    .select("crew_session_id, restaurant_id, code_version, restaurants!inner(is_active, code_version)")
    .eq("token_hash", hashOpaqueRestaurantToken(token))
    .eq("restaurant_id", restaurantId)
    .gt("expires_at", new Date().toISOString())
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data || data.code_version !== data.restaurants.code_version) return null;
  return { crewSessionId: data.crew_session_id as string, restaurantId: data.restaurant_id as string, codeVersion: data.code_version as number };
}
