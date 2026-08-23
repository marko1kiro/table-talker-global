import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { validateRestaurantCode } from "./restaurant-domain";
import { getServiceClient } from "./remote-audio.server";
import { getLoginRateLimitBuckets } from "./login-request-ip.server";

export type ManifestItem = {
  audioId: string;
  label: string;
  category: string;
  r2Url: string;
  contentHash: string;
  byteSize: number;
};

const CODE_ERROR = "Kode Resto salah.";

function offline() {
  return { offline: true as const, message: "Realtime offline" };
}

const serverCredentialModules = createServerOnlyFn(async () => {
  const code = await import(/* @vite-ignore */ "./restaurant-code.server");
  const session = await import(/* @vite-ignore */ "./restaurant-session.server");
  return { ...code, ...session };
});

export const loginToRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ code: z.string(), clientKey: z.string().min(16).max(200) }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return { error: CODE_ERROR };

    try {
      const {
        hashRestaurantCode,
        parseRestaurantCodeEncryptionKey,
        createOpaqueRestaurantToken,
        hashOpaqueRestaurantToken,
      } = await serverCredentialModules();
      const key = parseRestaurantCodeEncryptionKey(
        process.env.RESTAURANT_CODE_ENCRYPTION_KEY ?? "",
      );
      const validated = validateRestaurantCode(data.code);
      const valid = "code" in validated;
      const codeHash = hashRestaurantCode(valid ? validated.code : "INVALID", key);
      const { clientKeyHash, ipKeyHash } = getLoginRateLimitBuckets(
        getRequest().headers,
        data.clientKey,
        hashOpaqueRestaurantToken,
      );
      const [clientLimit, ipLimit] = await Promise.all([
        client.rpc("check_tenant_login_rate_limit", {
          p_lookup_hash: codeHash,
          p_bucket_hash: clientKeyHash,
        }),
        client.rpc("check_tenant_login_rate_limit", {
          p_lookup_hash: codeHash,
          p_bucket_hash: ipKeyHash,
        }),
      ]);
      if (clientLimit.error || ipLimit.error || clientLimit.data || ipLimit.data)
        return { error: CODE_ERROR };
      const { data: restaurant, error: lookupError } = await client
        .from("restaurants")
        .select("id, code_version, display_name, is_active")
        .eq("code_hash", codeHash)
        .single();
      if (!valid || !restaurant || lookupError || !restaurant.is_active) {
        await Promise.all([
          client.rpc("record_tenant_login_failure", {
            p_lookup_hash: codeHash,
            p_bucket_hash: clientKeyHash,
          }),
          client.rpc("record_tenant_login_failure", {
            p_lookup_hash: codeHash,
            p_bucket_hash: ipKeyHash,
          }),
        ]);
        return { error: CODE_ERROR };
      }
      await Promise.all([
        client.rpc("clear_tenant_login_failures", {
          p_lookup_hash: codeHash,
          p_bucket_hash: clientKeyHash,
        }),
        client.rpc("clear_tenant_login_failures", {
          p_lookup_hash: codeHash,
          p_bucket_hash: ipKeyHash,
        }),
      ]);
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

export const getRestaurantManifest = createServerFn({ method: "GET" })
  .validator(z.object({ restaurantId: z.string().uuid(), tenantToken: z.string() }))
  .handler(async ({ data }) => {
    const client = getServiceClient();
    if (!client) return offline();
    try {
      const { verifyActiveTenantSession } = await serverCredentialModules();
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
