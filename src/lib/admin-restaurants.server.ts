import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { validateRestaurantCode } from "./restaurant-domain";
import { getServiceClient } from "./remote-audio.server";

function noStore() {
  setResponseHeader("Cache-Control", "no-store");
}

export const createRestaurant = createServerFn({ method: "POST" })
  .validator(z.object({ restaurantCode: z.string(), displayName: z.string() }))
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat disimpan." };

    try {
      const { randomUUID } = await import("node:crypto");
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
      const validated = validateRestaurantCode(data.restaurantCode);
      if ("error" in validated) return { error: "Kode Resto tidak dapat disimpan." };
      const displayName = data.displayName.trim();
      if (!displayName || displayName.length > 80)
        return { error: "Nama resto 1\u201380 karakter." };
      const id = randomUUID();

      const { error } = await client.from("restaurants").insert({
        id,
        code: validated.code,
        code_version: 1,
        credential_rotated_at: new Date().toISOString(),
        display_name: displayName,
      });
      await writeRestaurantCredentialAudit(client, {
        restaurantId: id,
        operation: "created",
        success: !error,
        reason: error ? "unavailable" : undefined,
      });
      return error
        ? { error: "Kode Resto tidak dapat disimpan." }
        : { ok: true as const, restaurantId: id };
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
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
      const { data: restaurant, error } = await client
        .from("restaurants")
        .select("id, code")
        .eq("id", data.restaurantId)
        .single();
      if (error || !restaurant?.code) throw new Error("UNAVAILABLE");
      await writeRestaurantCredentialAudit(client, {
        restaurantId: data.restaurantId,
        operation: "viewed",
        success: true,
      });
      return { ok: true as const, code: restaurant.code };
    } catch {
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
      await writeRestaurantCredentialAudit(client, {
        restaurantId: data.restaurantId,
        operation: "viewed",
        success: false,
        reason: "unavailable",
      });
      return { error: "Kode Resto tidak dapat ditampilkan." };
    }
  });

export const changeRestaurantCode = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      displayNameConfirmation: z.string(),
      restaurantCode: z.string(),
      codeConfirmation: z.string(),
      superAdminPassword: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { requireRecentSuperAdmin } = await import("./auth.server");
    await requireRecentSuperAdmin(data.superAdminPassword);
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat disimpan." };
    try {
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
      const validated = validateRestaurantCode(data.restaurantCode);
      if (!("code" in validated) || data.restaurantCode !== data.codeConfirmation)
        throw new Error("INVALID");
      const { data: restaurant, error } = await client
        .from("restaurants")
        .select("id, display_name, code_version")
        .eq("id", data.restaurantId)
        .single();
      if (error || !restaurant || restaurant.display_name !== data.displayNameConfirmation)
        throw new Error("INVALID");
      const { error: rotateError } = await client.rpc("rotate_restaurant_credentials", {
        p_restaurant_id: restaurant.id,
        p_code: validated.code,
        p_next_code_version: restaurant.code_version + 1,
      });
      if (rotateError) throw new Error("UNAVAILABLE");
      await writeRestaurantCredentialAudit(client, {
        restaurantId: restaurant.id,
        operation: "rotated",
        success: true,
      });
      return { ok: true as const };
    } catch {
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
      await writeRestaurantCredentialAudit(client, {
        restaurantId: data.restaurantId,
        operation: "rotated",
        success: false,
        reason: "unavailable",
      });
      return { error: "Kode Resto tidak dapat disimpan." };
    }
  });

export const deactivateRestaurant = createServerFn({ method: "POST" })
  .validator(
    z.object({
      restaurantId: z.string().uuid(),
      displayNameConfirmation: z.string(),
      superAdminPassword: z.string().min(1),
    }),
  )
  .handler(async ({ data }) => {
    const { requireRecentSuperAdmin } = await import("./auth.server");
    await requireRecentSuperAdmin(data.superAdminPassword);
    noStore();
    const client = getServiceClient();
    if (!client) return { error: "Kode Resto tidak dapat disimpan." };
    try {
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
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
      await writeRestaurantCredentialAudit(client, {
        restaurantId: restaurant.id,
        operation: "deactivated",
        success: true,
      });
      return { ok: true as const };
    } catch {
      const { writeRestaurantCredentialAudit } = await import("./restaurant-audit.server");
      await writeRestaurantCredentialAudit(client, {
        restaurantId: data.restaurantId,
        operation: "deactivated",
        success: false,
        reason: "unavailable",
      });
      return { error: "Kode Resto tidak dapat disimpan." };
    }
  });
