import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { normalizeRestaurantCode, validateTenantLogin } from "./restaurant-domain";
import { getServiceClient } from "./remote-audio.server";

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
  .validator(z.object({ code: z.string(), pin: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const validated = validateTenantLogin({ code: data.code, pin: data.pin });
      if ("error" in validated) return { error: validated.error };

      const { data: restaurant, error: lookupError } = await client
        .from("restaurants")
        .select("id, code, display_name, is_active, deactivated_reason")
        .ilike("code", validated.code)
        .single();

      if (lookupError || !restaurant) return { error: "Resto tidak ditemukan." };
      if (!restaurant.is_active)
        return {
          error: `Resto tidak aktif.${restaurant.deactivated_reason ? ` ${restaurant.deactivated_reason}` : ""}`,
        };

      const { error: sessionError } = await client
        .from("restaurant_sessions")
        .upsert(
          { restaurant_id: restaurant.id, session_date: new Date().toISOString().slice(0, 10) },
          { onConflict: "restaurant_id,session_date" },
        );

      if (sessionError) return offline();

      return {
        ok: true as const,
        restaurantId: restaurant.id,
        restaurantCode: restaurant.code,
        displayName: restaurant.display_name,
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

export const getRestaurantManifest = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: items, error } = await client
        .from("audio_manifests")
        .select("audio_id, label, category, r2_url, content_hash, byte_size")
        .eq("restaurant_id", data.restaurantId)
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

      return { ok: true as const, manifest };
    } catch {
      return offline();
    }
  });
