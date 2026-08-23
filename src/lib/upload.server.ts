import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { createPresignedR2Upload, R2_UPLOAD_MAX_BYTES } from "./r2.server";
import { getServiceClient } from "./remote-audio.server";
import { isOwnerCatalogAudioId } from "./owner-restaurants-domain";

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

export const requestR2Upload = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      audioId: z.string().max(120),
      contentType: z.literal("audio/mpeg"),
      byteSize: z.number().int().min(1).max(R2_UPLOAD_MAX_BYTES),
      contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  )
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const client = getServiceClient();
    if (!client) return offline();

    const { data: restaurant, error } = await client
      .from("restaurants")
      .select("id")
      .eq("id", data.restaurantId)
      .single();
    if (error || !restaurant) return { error: "Resto tidak ditemukan." };

    if (!isOwnerCatalogAudioId(data.audioId)) return { error: "Audio tidak valid." };

    return { ok: true as const, ...(await createPresignedR2Upload(data)) };
  });
