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
      // Get current catalog version
      const { data: restaurant } = await client
        .from("restaurants")
        .select("id")
        .eq("id", data.restaurantId)
        .single();

      if (!restaurant) return { error: "Resto tidak ditemukan." };

      // Upsert: insert new version row
      const { error } = await client.from("audio_manifests").upsert(
        {
          restaurant_id: data.restaurantId,
          audio_id: data.audioId,
          label: data.label,
          category: data.category,
          r2_url: data.r2Url,
          content_hash: data.contentHash,
          byte_size: data.byteSize,
          active: true,
          ordering: data.ordering,
        },
        { onConflict: "restaurant_id,audio_id,catalog_version" },
      );

      if (error) return { error: "Gagal menyimpan manifest." };
      return { ok: true as const };
    } catch {
      return offline();
    }
  });

export const toggleManifestItem = createServerFn({ method: "POST" })
  .validator(z.object({ manifestId: z.string().uuid(), active: z.boolean() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { error } = await client
        .from("audio_manifests")
        .update({ active: data.active, updated_at: new Date().toISOString() })
        .eq("id", data.manifestId);

      if (error) return { error: "Gagal mengubah status." };
      return { ok: true as const };
    } catch {
      return offline();
    }
  });

export const deleteManifestItem = createServerFn({ method: "POST" })
  .validator(z.object({ manifestId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { error } = await client.from("audio_manifests").delete().eq("id", data.manifestId);

      if (error) return { error: "Gagal menghapus item." };
      return { ok: true as const };
    } catch {
      return offline();
    }
  });

export const listManifestItems = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: items, error } = await client
        .from("audio_manifests")
        .select("id, audio_id, label, category, r2_url, content_hash, byte_size, active, ordering, catalog_version, created_at, updated_at")
        .eq("restaurant_id", data.restaurantId)
        .order("category")
        .order("ordering");

      if (error) return offline();
      return { ok: true as const, items: items ?? [] };
    } catch {
      return offline();
    }
  });

export const bumpCatalogVersion = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      // Get current version
      const { data: restaurant } = await client
        .from("restaurants")
        .select("catalog_version")
        .eq("id", data.restaurantId)
        .single();

      if (!restaurant) return { error: "Resto tidak ditemukan." };

      const newVersion = (restaurant.catalog_version ?? 0) + 1;

      const { error } = await client
        .from("restaurants")
        .update({ catalog_version: newVersion })
        .eq("id", data.restaurantId);

      if (error) return { error: "Gagal update versi katalog." };
      return { ok: true as const, version: newVersion };
    } catch {
      return offline();
    }
  });
