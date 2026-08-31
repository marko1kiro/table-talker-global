import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export function createOpaqueRestaurantToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueRestaurantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function currentRestaurantVersion(
  restaurants:
    { is_active: boolean; code_version: number } | { is_active: boolean; code_version: number }[],
) {
  return Array.isArray(restaurants) ? restaurants[0]?.code_version : restaurants.code_version;
}

function isRestaurantActive(
  restaurants:
    { is_active: boolean; code_version: number } | { is_active: boolean; code_version: number }[],
) {
  return Array.isArray(restaurants) ? restaurants[0]?.is_active : restaurants.is_active;
}

export async function verifyActiveTenantSession(client: SupabaseClient, token: string) {
  const { data, error } = await client
    .from("restaurant_access_tokens")
    .select("restaurant_id, code_version, restaurants!inner(is_active, code_version)")
    .eq("token_hash", hashOpaqueRestaurantToken(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (
    error ||
    !data ||
    !isRestaurantActive(data.restaurants) ||
    data.code_version !== currentRestaurantVersion(data.restaurants)
  )
    return null;
  return { restaurantId: data.restaurant_id as string, codeVersion: data.code_version as number };
}

export async function verifyCrewSessionToken(
  client: SupabaseClient,
  token: string,
  restaurantId: string,
) {
  const { data, error } = await client
    .from("crew_session_tokens")
    .select(
      "crew_session_id, restaurant_id, code_version, restaurants!inner(is_active, code_version)",
    )
    .eq("token_hash", hashOpaqueRestaurantToken(token))
    .eq("restaurant_id", restaurantId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (
    error ||
    !data ||
    !isRestaurantActive(data.restaurants) ||
    data.code_version !== currentRestaurantVersion(data.restaurants)
  )
    return null;
  return {
    crewSessionId: data.crew_session_id as string,
    restaurantId: data.restaurant_id as string,
    codeVersion: data.code_version as number,
  };
}
