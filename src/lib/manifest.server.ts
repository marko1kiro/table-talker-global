import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";
import { r2Key, r2PublicUrl, verifyR2Upload } from "./r2.server";
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

async function manifestItem(
  client: NonNullable<ReturnType<typeof getServiceClient>>,
  restaurantId: string,
  audioId: string,
) {
  const { data: restaurant, error: restaurantError } = await client
    .from("restaurants")
    .select("catalog_version")
    .eq("id", restaurantId)
    .single();
  if (restaurantError) return undefined;
  if (!restaurant) return null;
  const { data, error } = await client
    .from("audio_manifests")
    .select("audio_id, label, category, r2_url, content_hash, byte_size, active, ordering")
    .eq("restaurant_id", restaurantId)
    .eq("audio_id", audioId)
    .eq("catalog_version", restaurant.catalog_version)
    .maybeSingle();
  return error ? undefined : data;
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
    try {
      await verifyR2Upload(data);
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
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Gagal menyimpan manifest.",
        };
      }
      return { ok: true as const, version };
    } catch {
      return {
        ok: false as const,
        code: "VERIFY_FAILED" as const,
        message: "Verifikasi upload gagal.",
      };
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
      const item = await manifestItem(client, data.restaurantId, data.audioId);
      if (item === undefined) return offline();
      if (!item) return invalid("NOT_FOUND", "Audio tidak ditemukan.");
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "toggle",
        p_audio_id: data.audioId,
        p_item: { active: data.active },
      });

      if (error) return offline();
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
      const item = await manifestItem(client, data.restaurantId, data.audioId);
      if (item === undefined) return offline();
      if (!item) return invalid("NOT_FOUND", "Audio tidak ditemukan.");
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "delete",
        p_audio_id: data.audioId,
      });

      if (error) return offline();
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
      const item = await manifestItem(client, data.restaurantId, data.audioId);
      if (item === undefined) return offline();
      if (!item) return invalid("NOT_FOUND", "Audio tidak ditemukan.");
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "reorder",
        p_audio_id: data.audioId,
        p_item: { ordering: data.ordering },
      });
      return error ? offline() : { ok: true as const, version };
    } catch {
      return offline();
    }
  });

export const updateManifestMetadata = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      audioId: z.string().max(120),
      label: z.string().max(200),
      category: z.string().max(60),
      active: z.boolean(),
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
      const item = await manifestItem(client, data.restaurantId, data.audioId);
      if (item === undefined) return offline();
      if (!item) return invalid("NOT_FOUND", "Audio tidak ditemukan.");
      const validated = validateCatalogMutation({
        ...data,
        r2Url: item.r2_url,
        contentHash: item.content_hash,
        byteSize: item.byte_size,
      });
      if (!validated.ok) return invalid(validated.code, "Metadata audio tidak valid.");
      const { data: version, error } = await client.rpc("mutate_catalog", {
        p_restaurant_id: data.restaurantId,
        p_action: "upsert",
        p_audio_id: data.audioId,
        p_item: {
          label: validated.item.label,
          category: validated.item.category,
          r2_url: item.r2_url,
          content_hash: item.content_hash,
          byte_size: item.byte_size,
          ordering: data.ordering,
          active: data.active,
        },
      });
      return error ? offline() : { ok: true as const, version };
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
