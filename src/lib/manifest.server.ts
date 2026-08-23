import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { deleteFromR2, r2Key, r2PublicUrl, verifyR2Upload } from "./r2.server";
import { isOwnerCatalogAudioId, validateCatalogMutation } from "./owner-restaurants-domain";

function offline() {
  return { ok: false as const, code: "UNAVAILABLE" as const, message: "Realtime offline" };
}
function invalid(
  code: "INVALID_AUDIO_ID" | "INVALID_METADATA" | "UNAVAILABLE" | "NOT_FOUND",
  message: string,
) {
  return { ok: false as const, code, message };
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
    const validated = validateCatalogMutation(data);
    if (!validated.ok) return invalid(validated.code, "Metadata audio tidak valid.");
    const item = validated.item;

    const key = r2Key(data.restaurantId, item.audioId, data.contentHash);
    let verified = false;
    try {
      await verifyR2Upload(data);
      verified = true;
      if (data.r2Url !== r2PublicUrl(key)) throw new Error("URL R2 tidak sesuai upload.");
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "upsert",
        p_audio_id: item.audioId,
        p_item: {
          label: item.label,
          category: item.category,
          r2_url: data.r2Url,
          content_hash: data.contentHash,
          byte_size: data.byteSize,
          ordering: data.ordering,
        },
      });
      if (error) {
        await deleteFromR2(key);
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Gagal menyimpan manifest.",
        };
      }
      return { ok: true as const, version };
    } catch {
      if (verified) await deleteFromR2(key);
      return offline();
    }
  });

export const toggleManifestItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      audioId: z.string().max(120),
      active: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();
    if (!isOwnerCatalogAudioId(data.audioId))
      return invalid("INVALID_AUDIO_ID", "Audio tidak valid.");

    try {
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "toggle",
        p_audio_id: data.audioId,
        p_item: { active: data.active },
      });

      if (error)
        return {
          ok: false as const,
          code: "NOT_FOUND" as const,
          message: "Audio tidak ditemukan.",
        };
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
    if (!isOwnerCatalogAudioId(data.audioId))
      return invalid("INVALID_AUDIO_ID", "Audio tidak valid.");

    try {
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "delete",
        p_audio_id: data.audioId,
      });

      if (error)
        return {
          ok: false as const,
          code: "NOT_FOUND" as const,
          message: "Audio tidak ditemukan.",
        };
      return { ok: true as const, version };
    } catch {
      return offline();
    }
  });

export const reorderManifestItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      audioId: z.string().max(120),
      ordering: z.number().int().min(0).max(10_000),
    }),
  )
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();
    if (!isOwnerCatalogAudioId(data.audioId))
      return invalid("INVALID_AUDIO_ID", "Audio tidak valid.");
    try {
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "reorder",
        p_audio_id: data.audioId,
        p_item: { ordering: data.ordering },
      });
      return error
        ? { ok: false as const, code: "NOT_FOUND" as const, message: "Audio tidak ditemukan." }
        : { ok: true as const, version };
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
        .select(
          "id, audio_id, label, category, r2_url, content_hash, byte_size, active, ordering, catalog_version, created_at, updated_at",
        )
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
