import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { getServiceClient } from "./remote-audio.server";

// ESB App ID Panel -- see docs/superpowers/specs/
// 2026-08-30-esb-app-id-panel-qr-export-design.md, decisions 3 and 5.
//
// esb_app_id is configuration data, not a security credential like the
// restaurant login code, so every handler here uses only the light,
// plain "logged into /super-admin" check -- never the heavier,
// password-reauth-window check used for credential rotation/deactivation.
//
// The restaurant dropdown deliberately does NOT reuse
// listOwnerRestaurants()/owner_restaurant_list (that RPC does not return
// esb_app_id and is a shared surface other UI already depends on) --
// instead it reads the restaurants table directly via the service-role
// client, which already has unrestricted read access (only anon/
// authenticated are revoked at the table level).

function noStore() {
  setResponseHeader("Cache-Control", "no-store");
}

function unavailable() {
  return { ok: false as const, code: "UNAVAILABLE" as const };
}

export const listRestaurantsForEsbPanel = createServerFn({ method: "GET" }).handler(async () => {
  await requireSuperAdmin();
  noStore();
  const client = getServiceClient();
  if (!client) return unavailable();
  try {
    const { data, error } = await client
      .from("restaurants")
      .select("id, display_name, esb_app_id")
      .order("display_name", { ascending: true });
    if (error || !data) return unavailable();
    return { ok: true as const, restaurants: data };
  } catch {
    return unavailable();
  }
});

export const getRestaurantEsbAppId = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return unavailable();
    try {
      const { data: restaurant, error } = await client
        .from("restaurants")
        .select("id, display_name, esb_app_id")
        .eq("id", data.restaurantId)
        .maybeSingle();
      if (error) return unavailable();
      return !restaurant
        ? { ok: false as const, code: "NOT_FOUND" as const }
        : { ok: true as const, restaurant };
    } catch {
      return unavailable();
    }
  });

// A plain text field, deliberately not restricted to digits -- ESB has
// supplied only numeric app ids so far (see the spec's data table), but
// nothing in this app depends on that; keep the validation generic and
// let ESB's own back-office be the source of truth for the value's shape.
const esbAppIdSchema = z
  .string()
  .trim()
  .min(1, "ESB App ID wajib diisi.")
  .max(40, "ESB App ID terlalu panjang.");

export const setRestaurantEsbAppId = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid(), esbAppId: esbAppIdSchema }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "ESB App ID tidak dapat disimpan." };
    try {
      const { data: updated, error } = await client
        .from("restaurants")
        .update({ esb_app_id: data.esbAppId })
        .eq("id", data.restaurantId)
        .select("id")
        .maybeSingle();
      if (error || !updated) return { error: "ESB App ID tidak dapat disimpan." };
      return { ok: true as const };
    } catch {
      return { error: "ESB App ID tidak dapat disimpan." };
    }
  });
