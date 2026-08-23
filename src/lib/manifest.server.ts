import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

export const upsertManifestItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      audioId: z.string().max(120),
      label: z.string().max(200),
      category: z.string().max(60).default("BASE"),
      r2Url: z.string().url(),
      contentHash: z.string().max(128),
      byteSize: z.number().int().positive(),
      ordering: z.number().int().default(0),
    }),
  )
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "upsert",
        p_audio_id: data.audioId,
        p_item: {
          label: data.label,
          category: data.category,
          r2_url: data.r2Url,
          content_hash: data.contentHash,
          byte_size: data.byteSize,
          ordering: data.ordering,
        },
      });
      if (error) return { error: "Gagal menyimpan manifest." };
      return { ok: true as const, version };
    } catch {
      return offline();
    }
  });

export const toggleManifestItem = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid(), audioId: z.string().max(120), active: z.boolean() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "toggle",
        p_audio_id: data.audioId,
        p_item: { active: data.active },
      });

      if (error) return { error: "Gagal mengubah status." };
      return { ok: true as const, version };
    } catch {
      return offline();
    }
  });

export const deleteManifestItem = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid(), audioId: z.string().max(120) }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "delete",
        p_audio_id: data.audioId,
      });

      if (error) return { error: "Gagal menghapus item." };
      return { ok: true as const, version };
    } catch {
      return offline();
    }
  });

export const listManifestItems = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: restaurant, error: restaurantError } = await client
        .from("restaurants")
        .select("catalog_version")
        .eq("id", data.restaurantId)
        .single();
      if (restaurantError || !restaurant) return offline();

      const { data: items, error } = await client
        .from("audio_manifests")
        .select("id, audio_id, label, category, r2_url, content_hash, byte_size, active, ordering, catalog_version, created_at, updated_at")
        .eq("restaurant_id", data.restaurantId)
        .eq("catalog_version", restaurant.catalog_version)
        .order("category")
        .order("ordering");

      if (error) return offline();
      return { ok: true as const, version: restaurant.catalog_version, items: items ?? [] };
    } catch {
      return offline();
    }
  });
