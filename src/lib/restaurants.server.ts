import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { normalizeRestaurantCode } from "./restaurant-domain";
import { getServiceClient } from "./remote-audio.server";
import {
  createTenantSession,
  hashTenantSession,
  hashRestaurantPin,
  verifyRestaurantPin,
  verifyActiveTenantSession,
} from "./tenant-session.server";

export type ManifestItem = {
  audioId: string;
  label: string;
  category: string;
  r2Url: string;
  contentHash: string;
  byteSize: number;
};

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

export const loginToRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string(), pin: z.string(), clientKey: z.string().min(16).max(200) }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const validated = normalizeRestaurantCode(data.code);
      if ("error" in validated) return { error: validated.error };
       const { data: restaurant, error: lookupError } = await client
        .from("restaurants")
        .select("id, code, display_name, is_active, deactivated_reason, pin_hash")
        .ilike("code", validated.code)
        .single();

      const clientKeyHash = hashTenantSession(data.clientKey);
      if (!restaurant || lookupError) return { error: "Kode resto atau PIN salah." };
      const { data: limited } = await client.rpc("check_tenant_login_rate_limit", {
        p_restaurant_id: restaurant.id,
        p_client_key_hash: clientKeyHash,
      });
      if (limited) return { error: "Kode resto atau PIN salah." };
      if (!verifyRestaurantPin(data.pin, restaurant.pin_hash)) {
        await client.rpc("record_tenant_login_failure", {
          p_restaurant_id: restaurant.id,
          p_client_key_hash: clientKeyHash,
        });
        return { error: "Kode resto atau PIN salah." };
      }
      if (!restaurant.is_active)
        return {
          error: `Resto tidak aktif.${restaurant.deactivated_reason ? ` ${restaurant.deactivated_reason}` : ""}`,
        };

      await client.rpc("clear_tenant_login_failures", {
        p_restaurant_id: restaurant.id,
        p_client_key_hash: clientKeyHash,
      });

      const { error: sessionError } = await client
        .from("restaurant_sessions")
        .upsert(
          { restaurant_id: restaurant.id, session_date: new Date().toISOString().slice(0, 10) },
          { onConflict: "restaurant_id,session_date" },
        );

      if (sessionError) return offline();

      const tenantToken = createTenantSession(restaurant.id);
       const { error: accessError } = await client.from("restaurant_access_tokens").insert({
         token_hash: hashTenantSession(tenantToken),
         restaurant_id: restaurant.id,
         expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      if (accessError) return offline();

      return {
        ok: true as const,
        restaurantId: restaurant.id,
        restaurantCode: restaurant.code,
        displayName: restaurant.display_name,
        tenantToken,
      };
    } catch {
      return offline();
    }
  });

export const createRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string(), displayName: z.string() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const normalized = normalizeRestaurantCode(data.code);
      if ("error" in normalized) return { error: normalized.error };
      const displayName = data.displayName.trim();
      if (!displayName || displayName.length > 80)
        return { error: "Nama resto 1\u201380 karakter." };

      const { error } = await client.from("restaurants").insert({
        code: normalized.code,
        display_name: displayName,
      });
      if (error?.message.includes("restaurants_code_key"))
        return { error: "Kode resto sudah dipakai." };
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
   });

export const setRestaurantPin = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid(), pin: z.string().min(4).max(128) }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { error } = await client
        .from("restaurants")
        .update({ pin_hash: hashRestaurantPin(data.pin) })
        .eq("id", data.restaurantId);
      return error ? offline() : { ok: true as const };
    } catch {
      return offline();
    }
  });

export const getRestaurantManifest = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid(), tenantToken: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const tenant = await verifyActiveTenantSession(client, data.tenantToken);
      if (!tenant || tenant.restaurantId !== data.restaurantId) return { error: "Sesi resto tidak valid." };

      const { data: restaurant, error: restaurantError } = await client
        .from("restaurants")
        .select("catalog_version, is_active")
        .eq("id", data.restaurantId)
        .single();
      if (restaurantError || !restaurant) return offline();

      const { data: items, error } = await client
        .from("audio_manifests")
        .select("audio_id, label, category, r2_url, content_hash, byte_size")
        .eq("restaurant_id", data.restaurantId)
        .eq("catalog_version", restaurant.catalog_version)
        .eq("active", true)
        .order("category")
        .order("ordering");

      if (error) return offline();

      const manifest: ManifestItem[] = (items ?? []).map((row) => ({
        audioId: row.audio_id,
        label: row.label,
        category: row.category,
        r2Url: row.r2_url,
        contentHash: row.content_hash,
        byteSize: row.byte_size,
      }));

      return { ok: true as const, version: restaurant.catalog_version, manifest };
    } catch {
      return offline();
    }
  });

export const listRestaurants = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: restaurants, error } = await client
        .from("restaurants")
        .select("id, code, display_name, is_active, catalog_version")
        .order("code");

      if (error) return offline();
      return { ok: true as const, restaurants: restaurants ?? [] };
    } catch {
      return offline();
    }
  });
