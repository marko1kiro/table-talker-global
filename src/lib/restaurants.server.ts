import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { getServiceClient } from "./remote-audio.server";

export type ManifestItem = {
  audioId: string;
  label: string;
  category: string;
  downloadUrl: string;
  downloadGrant: string;
  contentHash: string;
  byteSize: number;
};

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

const serverCredentialModules = createServerOnlyFn(async () => ({
  ...(await import("./audio-download-grant.server")),
  ...(await import("./restaurant-code.server")),
  ...(await import("./restaurant-session.server")),
}));

// Poin 3 Task 9 (hard cutover): the crew "kode + PIN" tenant-minting server fns
// are DELETED. The crew account flow now mints its own restaurant tenant token
// server-side (crew_shift_claim, Task 5) and does the code->identity lookup via
// crewValidateCode, so nothing in src called either fns anymore. The
// login_to_restaurant_atomic RPC itself is left in place (provisioning/ops
// tooling is not this repo's call to prune); only the dead crew call-site is
// gone. getRestaurantManifest below stays: the SS soundboard reads the audio
// catalog with the tenant token handed back by crew_shift_claim
// (verifyActiveTenantSession -> restaurant_access_tokens).
export const getRestaurantManifest = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid(), tenantToken: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();
    try {
      const { createAudioDownloadGrant, verifyActiveTenantSession } =
        await serverCredentialModules();
      const tenant = await verifyActiveTenantSession(client, data.tenantToken);
      if (!tenant || tenant.restaurantId !== data.restaurantId)
        return { error: "Sesi resto tidak valid." };
      const { data: restaurant, error: restaurantError } = await client
        .from("restaurants")
        .select("catalog_version, is_active")
        .eq("id", data.restaurantId)
        .single();
      if (restaurantError || !restaurant) return offline();
      const { data: items, error } = await client
        .from("audio_manifests")
        .select("audio_id, label, category, content_hash, byte_size")
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
        downloadUrl: `/api/audio/${encodeURIComponent(row.audio_id)}?restaurantId=${encodeURIComponent(data.restaurantId)}`,
        downloadGrant: createAudioDownloadGrant({
          restaurantId: data.restaurantId,
          audioId: row.audio_id,
          contentHash: row.content_hash,
          byteSize: row.byte_size,
        }),
        contentHash: row.content_hash,
        byteSize: row.byte_size,
      }));
      return { ok: true as const, version: restaurant.catalog_version, manifest };
    } catch {
      return offline();
    }
  });
