import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { validateRestaurantCode } from "./restaurant-domain";
import { getServiceClient } from "./remote-audio.server";
import { decryptRestaurantCode, encryptRestaurantCode, hashRestaurantCode, parseRestaurantCodeEncryptionKey } from "./restaurant-code.server";
import { writeRestaurantCredentialAudit } from "./restaurant-audit.server";
import { createOpaqueRestaurantToken, hashOpaqueRestaurantToken, verifyActiveTenantSession } from "./restaurant-session.server";

export type ManifestItem = {
  audioId: string;
  label: string;
  category: string;
  r2Url: string;
  contentHash: string;
  byteSize: number;
};

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

const CODE_ERROR = "Kode Resto salah.";

function noStore() {
  setResponseHeader("Cache-Control", "no-store");
}

function getRestaurantCodeKey() {
  return parseRestaurantCodeEncryptionKey(process.env.RESTAURANT_CODE_ENCRYPTION_KEY ?? "");
}

export const loginToRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string(), clientKey: z.string().min(16).max(200) }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { error: CODE_ERROR };

    try {
      const validated = validateRestaurantCode(data.code);
      const codeHash = hashRestaurantCode("code" in validated ? validated.code : "INVALID", getRestaurantCodeKey());
      const { data: restaurant, error: lookupError } = await client
         .from("restaurants")
         .select("id, code_version, display_name, is_active")
         .eq("code_hash", codeHash)
         .single();

       const clientKeyHash = hashOpaqueRestaurantToken(data.clientKey);
       if (!("code" in validated) || !restaurant || lookupError || !restaurant.is_active) return { error: CODE_ERROR };
       const { data: limited, error: rateLimitError } = await client.rpc("check_tenant_login_rate_limit", {
         p_restaurant_id: restaurant.id,
         p_client_key_hash: clientKeyHash,
       });
       if (rateLimitError || limited) return { error: CODE_ERROR };

      await client.rpc("clear_tenant_login_failures", {
        p_restaurant_id: restaurant.id,
        p_client_key_hash: clientKeyHash,
      });

      const { error: sessionError } = await client
        .from("restaurant_sessions")
        .upsert(
          { restaurant_id: restaurant.id, session_date: new Date().toISOString().slice(0, 10) },
          { onConflict: "restaurant_id,session_date" },
        );

       if (sessionError) return { error: CODE_ERROR };

      const tenantToken = createOpaqueRestaurantToken();
       const { error: accessError } = await client.from("restaurant_access_tokens").insert({
          token_hash: hashOpaqueRestaurantToken(tenantToken),
         restaurant_id: restaurant.id,
          code_version: restaurant.code_version,
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      });
       if (accessError) return { error: CODE_ERROR };

      return {
        ok: true as const,
        restaurantId: restaurant.id,
         displayName: restaurant.display_name,
        tenantToken,
      };
    } catch {
      return { error: CODE_ERROR };
    }
  });

export const createRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantCode: z.string(), displayName: z.string() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat disimpan." };

    try {
       const validated = validateRestaurantCode(data.restaurantCode);
       if ("error" in validated) return { error: "Kode Resto tidak dapat disimpan." };
       const displayName = data.displayName.trim();
       if (!displayName || displayName.length > 80)
         return { error: "Nama resto 1\u201380 karakter." };
       const id = randomUUID();
       const key = getRestaurantCodeKey();

       const { error } = await client.from("restaurants").insert({
         id,
         code_hash: hashRestaurantCode(validated.code, key),
         code_encrypted: encryptRestaurantCode(validated.code, id, key),
         display_name: displayName,
       });
       await writeRestaurantCredentialAudit(client, { restaurantId: id, operation: "created", success: !error, reason: error ? "unavailable" : undefined });
       return error ? { error: "Kode Resto tidak dapat disimpan." } : { ok: true as const, restaurantId: id };
    } catch {
      return { error: "Kode Resto tidak dapat disimpan." };
    }
  });

export const viewRestaurantCode = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat ditampilkan." };
    try {
      const { data: restaurant, error } = await client.from("restaurants").select("id, code_encrypted").eq("id", data.restaurantId).single();
      if (error || !restaurant?.code_encrypted) throw new Error("UNAVAILABLE");
      const code = decryptRestaurantCode(restaurant.code_encrypted, restaurant.id, getRestaurantCodeKey());
      await writeRestaurantCredentialAudit(client, { restaurantId: data.restaurantId, operation: "viewed", success: true });
      return { ok: true as const, code };
    } catch {
      await writeRestaurantCredentialAudit(client, { restaurantId: data.restaurantId, operation: "viewed", success: false, reason: "unavailable" });
      return { error: "Kode Resto tidak dapat ditampilkan." };
    }
  });

export const changeRestaurantCode = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid(), displayNameConfirmation: z.string(), restaurantCode: z.string(), codeConfirmation: z.string() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat disimpan." };
    try {
      const validated = validateRestaurantCode(data.restaurantCode);
      if (!("code" in validated) || data.restaurantCode !== data.codeConfirmation) throw new Error("INVALID");
      const { data: restaurant, error } = await client.from("restaurants").select("id, display_name, code_version").eq("id", data.restaurantId).single();
      if (error || !restaurant || restaurant.display_name !== data.displayNameConfirmation) throw new Error("INVALID");
      const key = getRestaurantCodeKey();
      const { error: rotateError } = await client.rpc("rotate_restaurant_credentials", {
        p_restaurant_id: restaurant.id,
        p_code_hash: hashRestaurantCode(validated.code, key),
        p_code_encrypted: encryptRestaurantCode(validated.code, restaurant.id, key),
        p_next_code_version: restaurant.code_version + 1,
      });
      if (rotateError) throw new Error("UNAVAILABLE");
      await writeRestaurantCredentialAudit(client, { restaurantId: restaurant.id, operation: "rotated", success: true });
      return { ok: true as const };
    } catch {
      await writeRestaurantCredentialAudit(client, { restaurantId: data.restaurantId, operation: "rotated", success: false, reason: "unavailable" });
      return { error: "Kode Resto tidak dapat disimpan." };
    }
  });

export const deactivateRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantId: z.string().uuid(), displayNameConfirmation: z.string() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat disimpan." };
    try {
      const { data: restaurant, error } = await client
        .from("restaurants")
        .select("id, display_name, code_version")
        .eq("id", data.restaurantId)
        .single();
      if (error || !restaurant || restaurant.display_name !== data.displayNameConfirmation)
        throw new Error("INVALID");
      const { error: deactivateError } = await client.rpc("deactivate_restaurant_credentials", {
        p_restaurant_id: restaurant.id,
        p_next_code_version: restaurant.code_version + 1,
      });
      if (deactivateError) throw new Error("UNAVAILABLE");
      await writeRestaurantCredentialAudit(client, { restaurantId: restaurant.id, operation: "deactivated", success: true });
      return { ok: true as const };
    } catch {
      await writeRestaurantCredentialAudit(client, { restaurantId: data.restaurantId, operation: "deactivated", success: false, reason: "unavailable" });
      return { error: "Kode Resto tidak dapat disimpan." };
    }
  });

export const getRestaurantDetail = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return offline();
    try {
      const { data: restaurant, error } = await client
        .from("restaurants")
        .select("id, display_name, is_active, catalog_version, credential_rotated_at")
        .eq("id", data.restaurantId)
        .single();
      return error || !restaurant ? offline() : { ok: true as const, restaurant };
    } catch {
      return offline();
    }
  });

export const getRestaurantManifest = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid(), tenantToken: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const tenant = await verifyActiveTenantSession(client, data.tenantToken);
      if (!tenant || tenant.restaurantId !== data.restaurantId) return { error: "Sesi resto tidak valid." };

      const { data: restaurant, error: restaurantError } = await client
        .from("restaurants")
        .select("catalog_version, is_active")
        .eq("id", data.restaurantId)
        .single();
      if (restaurantError || !restaurant) return offline();

      const { data: items, error } = await client
        .from("audio_manifests")
        .select("audio_id, label, category, r2_url, content_hash, byte_size")
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
        r2Url: row.r2_url,
        contentHash: row.content_hash,
        byteSize: row.byte_size,
      }));

      return { ok: true as const, version: restaurant.catalog_version, manifest };
    } catch {
      return offline();
    }
  });

export const listRestaurants = createServerFn({ method: "GET" })
  .handler(async () => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return offline();

    try {
      const { data: restaurants, error } = await client
        .from("restaurants")
         .select("id, display_name, is_active, catalog_version")
         .order("display_name");

      if (error) return offline();
      return { ok: true as const, restaurants: restaurants ?? [] };
    } catch {
      return offline();
    }
  });
