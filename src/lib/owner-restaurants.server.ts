import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

function unavailable() {
  return { ok: false as const, code: "UNAVAILABLE" as const };
}

export const listOwnerRestaurants = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  setResponseHeader("Cache-Control", "no-store");
  const client = getServiceClient();
  if (!client) return unavailable();
  try {
    const { data, error } = await client.rpc("owner_restaurant_list");
    return error || !data ? unavailable() : { ok: true as const, restaurants: data };
  } catch {
    return unavailable();
  }
});

export const getOwnerRestaurantDetail = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    setResponseHeader("Cache-Control", "no-store");
    const client = getServiceClient();
    if (!client) return unavailable();
    try {
      const { data: detail, error } = await client.rpc("owner_restaurant_detail", {
        p_restaurant_id: data.restaurantId,
      });
      return error || !detail
        ? { ok: false as const, code: "NOT_FOUND" as const }
        : { ok: true as const, detail };
    } catch {
      return unavailable();
    }
  });
