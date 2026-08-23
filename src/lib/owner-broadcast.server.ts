import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { groupBroadcastResults, validateBroadcastRequest } from "./owner-broadcast-domain";
import { getServiceClient } from "./remote-audio.server";

const MAX_RESTAURANTS = 100;
const MAX_DEVICES = 500;

const scopeSchema = z.object({
  scope: z.enum(["restaurant", "all"]),
  restaurantId: z.string().uuid().optional(),
});

export type BroadcastPreviewRestaurant = {
  restaurantId: string;
  displayName: string;
  sessionIds: string[];
};

async function resolveBroadcastTargets(
  client: NonNullable<ReturnType<typeof getServiceClient>>,
  scope: "restaurant" | "all",
  restaurantId?: string,
) {
  let restaurantQuery = client
    .from("restaurants")
    .select("id,display_name")
    .eq("is_active", true)
    .order("display_name")
    .limit(MAX_RESTAURANTS + 1);
  if (scope === "restaurant") restaurantQuery = restaurantQuery.eq("id", restaurantId!);
  const { data: restaurants, error: restaurantError } = await restaurantQuery;
  if (restaurantError) return { ok: false as const, code: "UNAVAILABLE" as const };
  if (scope === "restaurant" && !restaurants?.length)
    return { ok: false as const, code: "RESTAURANT_NOT_FOUND" as const };
  if ((restaurants?.length ?? 0) > MAX_RESTAURANTS)
    return { ok: false as const, code: "BATCH_TOO_LARGE" as const };

  const ids = (restaurants ?? []).map((restaurant) => restaurant.id);
  if (!ids.length) return { ok: true as const, restaurants: [] };
  const { data: sessions, error: sessionError } = await client
    .from("crew_sessions")
    .select("id,restaurant_id")
    .in("restaurant_id", ids)
    .eq("connection_state", "connected")
    .eq("visibility_state", "visible")
    .eq("audio_ready", true)
    .gt("last_seen", new Date(Date.now() - 30_000).toISOString())
    .order("id")
    .limit(MAX_DEVICES + 1);
  if (sessionError) return { ok: false as const, code: "UNAVAILABLE" as const };
  if ((sessions?.length ?? 0) > MAX_DEVICES)
    return { ok: false as const, code: "BATCH_TOO_LARGE" as const };

  return {
    ok: true as const,
    restaurants: (restaurants ?? []).map((restaurant) => ({
      restaurantId: restaurant.id,
      displayName: restaurant.display_name,
      sessionIds: (sessions ?? [])
        .filter((session) => session.restaurant_id === restaurant.id)
        .map((session) => session.id),
    })),
  };
}

export const previewOwnerBroadcast = createServerFn({ method: "GET" })
  .validator(scopeSchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    if (data.scope === "restaurant" && !data.restaurantId)
      return { ok: false as const, code: "RESTAURANT_REQUIRED" as const, message: "Pilih resto." };
    const client = getServiceClient();
    if (!client)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast tidak tersedia.",
      };
    const targets = await resolveBroadcastTargets(client, data.scope, data.restaurantId);
    if (!targets.ok)
      return {
        ok: false as const,
        code: targets.code,
        message: "Target broadcast tidak tersedia.",
      };
    return {
      ok: true as const,
      restaurantCount: targets.restaurants.length,
      deviceCount: targets.restaurants.reduce(
        (total, restaurant) => total + restaurant.sessionIds.length,
        0,
      ),
      restaurants: targets.restaurants.map((restaurant) => ({
        restaurantId: restaurant.restaurantId,
        displayName: restaurant.displayName,
        deviceCount: restaurant.sessionIds.length,
      })),
    };
  });

const sendSchema = scopeSchema.extend({
  message: z.string().max(201),
  confirmation: z.string().optional(),
});

export const sendOwnerBroadcast = createServerFn({ method: "POST" })
  .validator(sendSchema)
  .handler(async ({ data }) => {
    await requireSuperAdmin();
    const validation = validateBroadcastRequest(data);
    if (!validation.ok)
      return { ok: false as const, code: validation.code, message: "Data broadcast tidak valid." };
    const client = getServiceClient();
    if (!client)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast tidak tersedia.",
      };
    const { data: allowed, error: rateError } = await client.rpc(
      "check_owner_broadcast_rate_limit",
      { p_actor: "super-admin", p_max_requests: 10, p_window_seconds: 3600 },
    );
    if (rateError)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast tidak tersedia.",
      };
    if (!allowed)
      return {
        ok: false as const,
        code: "RATE_LIMITED" as const,
        message: "Terlalu banyak broadcast.",
      };
    const targets = await resolveBroadcastTargets(client, data.scope, data.restaurantId);
    if (!targets.ok)
      return {
        ok: false as const,
        code: targets.code,
        message: "Target broadcast tidak tersedia.",
      };

    const { data: broadcast, error: createError } = await client
      .from("owner_broadcasts")
      .insert({
        actor: "super-admin",
        scope: data.scope,
        restaurant_id: data.scope === "restaurant" ? data.restaurantId : null,
        message: validation.message,
      })
      .select("id")
      .single();
    if (createError || !broadcast)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast gagal dibuat.",
      };

    const settled = await Promise.allSettled(
      targets.restaurants.map(async (restaurant) => {
        const deliveries = await Promise.allSettled(
          restaurant.sessionIds.map((sessionId) =>
            client.rpc("create_owner_broadcast_delivery", {
              p_broadcast_id: broadcast.id,
              p_restaurant_id: restaurant.restaurantId,
              p_crew_session_id: sessionId,
              p_message: validation.message,
            }),
          ),
        );
        const counts = { delivered: 0, failed: 0, rejected: 0, expired: 0 };
        for (const delivery of deliveries) {
          if (delivery.status === "rejected" || delivery.value.error) counts.failed += 1;
          else {
            const status = (delivery.value.data as { status?: keyof typeof counts } | null)?.status;
            if (status && status in counts) counts[status] += 1;
            else counts.failed += 1;
          }
        }
        return {
          restaurantId: restaurant.restaurantId,
          displayName: restaurant.displayName,
          ...counts,
        };
      }),
    );
    const results = settled.map((result, index) =>
      result.status === "fulfilled"
        ? result.value
        : {
            restaurantId: targets.restaurants[index].restaurantId,
            displayName: targets.restaurants[index].displayName,
            delivered: 0,
            failed: targets.restaurants[index].sessionIds.length || 1,
            rejected: 0,
            expired: 0,
          },
    );
    return {
      ok: true as const,
      broadcastId: broadcast.id,
      results,
      totals: groupBroadcastResults(results),
    };
  });
