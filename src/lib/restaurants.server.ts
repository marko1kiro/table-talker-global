import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { validateRestaurantCode } from "./restaurant-domain";
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

const CODE_ERROR = "Kode Resto salah.";
const PIN_ERROR = "ID Resto salah.";
const PIN_PATTERN = /^[0-9]{4}$/;

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

const serverCredentialModules = createServerOnlyFn(async () => ({
  ...(await import("./audio-download-grant.server")),
  ...(await import("./restaurant-code.server")),
  ...(await import("./restaurant-session.server")),
}));

export const loginToRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { error: CODE_ERROR };

    try {
      const { createOpaqueRestaurantToken, hashOpaqueRestaurantToken } =
        await serverCredentialModules();
      const validated = validateRestaurantCode(data.code);
      const valid = "code" in validated;
      const tenantToken = createOpaqueRestaurantToken();
      const { data: restaurant, error } = await client.rpc("login_to_restaurant_atomic", {
        p_code: valid ? validated.code : "\n",
        p_token_hash: hashOpaqueRestaurantToken(tenantToken),
        p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
      const login = restaurant?.[0];
      if (!valid || error || !login) return { error: CODE_ERROR };
      return {
        ok: true as const,
        restaurantId: login.p_rid,
        displayName: login.p_rname,
        tenantToken,
      };
    } catch {
      return { error: CODE_ERROR };
    }
  });

// Second factor after Kode Resto: an admin-issued 4-digit PIN unique per
// restaurant ("ID Resto"), added so a crew member who only knows/guesses a
// Kode Resto (which is not treated as a secret -- see restaurant-code.server.ts)
// cannot get into another restaurant's dashboard.
//
// C-01 remediation (Fase 1, 2026-09-02): this function is UX-only -- fast
// inline feedback at the PIN entry step -- and is NOT the authorization
// boundary. The one and only authoritative PIN check now lives inside the
// claim_role_session RPC itself (supabase/migrations/
// 20260902020000_pin_hash_and_role_session_hardening.sql), which verifies
// the PIN in the same transaction as issuing the role session token. Before
// this change, verifyRestaurantPin was the *only* place the PIN was ever
// checked, and claim_role_session accepted no PIN at all -- so calling
// claim_role_session directly with a valid tenant token, skipping this
// serverFn entirely, bypassed the PIN completely. Compares against
// restaurants.pin_hash (sha256 hex), scoped to the restaurant already
// resolved by tenantToken (verifyActiveTenantSession), so this can never be
// used to probe other restaurants' PINs by supplying a different
// restaurantId. Rate limiting for repeated wrong PINs lives in the RPC, not
// here, since this endpoint is not the security boundary.
export const verifyRestaurantPin = createServerFn({ method: "POST" })
  .validator(z.object({ tenantToken: z.string(), pin: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { error: PIN_ERROR };
    if (!PIN_PATTERN.test(data.pin)) return { error: PIN_ERROR };

    try {
      const { verifyActiveTenantSession, hashOpaqueRestaurantToken } =
        await serverCredentialModules();
      const tenant = await verifyActiveTenantSession(client, data.tenantToken);
      if (!tenant) return { error: "Sesi resto tidak valid. Ulangi dari Kode Resto." };

      const { data: restaurant, error } = await client
        .from("restaurants")
        .select("pin_hash")
        .eq("id", tenant.restaurantId)
        .single();
      if (error || !restaurant || restaurant.pin_hash !== hashOpaqueRestaurantToken(data.pin))
        return { error: PIN_ERROR };
      return { ok: true as const };
    } catch {
      return { error: PIN_ERROR };
    }
  });

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
