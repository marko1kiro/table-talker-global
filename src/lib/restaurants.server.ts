import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { normalizeRestaurantCode } from "./restaurant-domain";
import { getServiceClient } from "./remote-audio.server";

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

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
