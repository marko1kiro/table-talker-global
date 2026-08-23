import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { uploadToR2 } from "./r2.server";

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

export const uploadAudioToR2 = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      audioId: z.string().max(120),
      buffer: z.array(z.number().int().min(0).max(255)).max(50 * 1024 * 1024),
      fileName: z.string().max(200),
    }),
  )
  .handler(async ({ data }) => {
    await requireSuperAdmin();

    try {
      const arrayBuffer = new Uint8Array(data.buffer).buffer;
      const result = await uploadToR2(data.restaurantId, data.audioId, arrayBuffer);

      if (!result) return { error: "Upload ke R2 gagal." };
      return { ok: true as const, url: result.url, hash: result.hash, byteSize: result.byteSize };
    } catch {
      return { error: "Upload ke R2 gagal." };
    }
  });
