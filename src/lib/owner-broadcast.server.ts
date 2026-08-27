import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSuperAdmin } from "./auth.server";
import { groupBroadcastResults, validateBroadcastRequest } from "./owner-broadcast-domain";
import { getServiceClient } from "./remote-audio.server";
import {
  canonicalBroadcastPayload,
  fingerprintBroadcastPayload,
} from "./owner-broadcast-idempotency.server";

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
  idempotencyKey: z.string().uuid(),
});

async function getBroadcastHistory(
  client: NonNullable<ReturnType<typeof getServiceClient>>,
  broadcastId: string,
) {
  const { data: targets, error: targetError } = await client
    .from("owner_broadcast_targets")
    .select("restaurant_id,display_name")
    .eq("broadcast_id", broadcastId)
    .order("restaurant_id");
  if (targetError) return null;
  const { data: deliveries, error } = await client
    .from("owner_broadcast_deliveries")
    .select("restaurant_id,status")
    .eq("broadcast_id", broadcastId);
  if (error) return null;
  return (targets ?? []).map((target) => {
    const counts = { delivered: 0, failed: 0, rejected: 0, expired: 0 };
    for (const delivery of deliveries ?? [])
      if (delivery.restaurant_id === target.restaurant_id && delivery.status in counts)
        counts[delivery.status as keyof typeof counts] += 1;
    return { restaurantId: target.restaurant_id, displayName: target.display_name, ...counts };
  });
}

async function resolveSnapshotSessions(
  client: NonNullable<ReturnType<typeof getServiceClient>>,
  broadcastId: string,
) {
  const { data: targets, error: targetError } = await client
    .from("owner_broadcast_targets")
    .select("restaurant_id,display_name")
    .eq("broadcast_id", broadcastId)
    .order("restaurant_id");
  if (targetError) return null;
  const { data: recipients, error: recipientError } = await client
    .from("owner_broadcast_recipients")
    .select("crew_session_id,restaurant_id")
    .eq("broadcast_id", broadcastId)
    .order("crew_session_id");
  if (recipientError) return null;
  const { data: deliveries, error: deliveryError } = await client
    .from("owner_broadcast_deliveries")
    .select("crew_session_id")
    .eq("broadcast_id", broadcastId);
  if (deliveryError) return null;
  const delivered = new Set((deliveries ?? []).map((delivery) => delivery.crew_session_id));
  return (targets ?? []).map((target) => ({
    restaurantId: target.restaurant_id,
    displayName: target.display_name,
    sessionIds: (recipients ?? [])
      .filter(
        (recipient) =>
          recipient.restaurant_id === target.restaurant_id &&
          !delivered.has(recipient.crew_session_id),
      )
      .map((recipient) => recipient.crew_session_id),
  }));
}

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
    const restaurantId = data.scope === "restaurant" ? data.restaurantId : undefined;
    const canonical = canonicalBroadcastPayload({
      actor: "super-admin",
      scope: data.scope,
      restaurantId,
      message: validation.message,
    });
    const { data: existing, error: existingError } = await client
      .from("owner_broadcasts")
      .select("id,status")
      .eq("actor", "super-admin")
      .eq("idempotency_key", data.idempotencyKey)
      .maybeSingle();
    if (existingError)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast tidak tersedia.",
      };
    let targets = existing ? null : await resolveBroadcastTargets(client, data.scope, restaurantId);
    if (targets && !targets.ok)
      return {
        ok: false as const,
        code: targets.code,
        message: "Target broadcast tidak tersedia.",
      };
    const { data: broadcast, error: createError } = await client.rpc(
      "create_or_get_owner_broadcast",
      {
        p_key: data.idempotencyKey,
        p_fingerprint: fingerprintBroadcastPayload(canonical),
        p_actor: "super-admin",
        p_scope: data.scope,
        p_restaurant_id: restaurantId ?? null,
        p_message: validation.message,
      },
    );
    if (createError?.message.includes("RATE_LIMITED"))
      return {
        ok: false as const,
        code: "RATE_LIMITED" as const,
        message: "Terlalu banyak broadcast.",
      };
    if (createError?.message.includes("IDEMPOTENCY_CONFLICT"))
      return {
        ok: false as const,
        code: "IDEMPOTENCY_CONFLICT" as const,
        message: "Permintaan broadcast berbeda.",
      };
    if (createError?.message.includes("IN_PROGRESS"))
      return {
        ok: false as const,
        code: "IN_PROGRESS" as const,
        message: "Broadcast sedang diproses.",
      };
    if (createError || !broadcast?.id || !broadcast.processingToken)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast gagal dibuat.",
      };
    if (broadcast.status === "creating" && broadcast.replayed && !broadcast.resume)
      return {
        ok: false as const,
        code: "IN_PROGRESS" as const,
        message: "Broadcast sedang diproses.",
      };
    if (broadcast.status === "complete") {
      const results = await getBroadcastHistory(client, broadcast.id);
      if (!results)
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Riwayat broadcast tidak tersedia.",
        };
      return {
        ok: true as const,
        broadcastId: broadcast.id,
        results,
        totals: groupBroadcastResults(results),
      };
    }

    if (!targets && broadcast.snapshotCreated) {
      const sessions = await resolveSnapshotSessions(client, broadcast.id);
      if (!sessions)
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Target broadcast tidak tersedia.",
        };
      targets = { ok: true, restaurants: sessions };
    }

    if (!targets) targets = await resolveBroadcastTargets(client, data.scope, restaurantId);

    if (!targets.ok)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Target broadcast tidak tersedia.",
      };

    if (!broadcast.snapshotCreated) {
      const { error: targetError } = await client.rpc("record_owner_broadcast_snapshot", {
        p_broadcast_id: broadcast.id,
        p_processing_token: broadcast.processingToken,
        p_targets: targets.restaurants.map((target) => ({
          restaurantId: target.restaurantId,
          displayName: target.displayName,
          sessionIds: target.sessionIds,
        })),
      });
      if (targetError)
        return {
          ok: false as const,
          code: "UNAVAILABLE" as const,
          message: "Target broadcast gagal disimpan.",
        };
    }

    const settled = await Promise.allSettled(
      targets.restaurants.map(async (restaurant) => {
        const deliveries = await Promise.allSettled(
          restaurant.sessionIds.map((sessionId) =>
            client.rpc("create_owner_broadcast_delivery", {
              p_broadcast_id: broadcast.id,
              p_processing_token: broadcast.processingToken,
              p_restaurant_id: restaurant.restaurantId,
              p_crew_session_id: sessionId,
              p_message: validation.message,
            }),
          ),
        );
        const counts = { delivered: 0, failed: 0, rejected: 0, expired: 0 };
        for (const delivery of deliveries) {
          if (delivery.status === "rejected") counts.failed += 1;
          else if (delivery.value.error?.message.includes("RECIPIENT_NOT_SNAPSHOTTED"))
            throw new Error("RECIPIENT_NOT_SNAPSHOTTED");
          else if (delivery.value.error) counts.failed += 1;
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
    if (settled.some((result) => result.status === "rejected"))
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast belum selesai.",
      };
    const { error: finalizeError } = await client.rpc("finalize_owner_broadcast", {
      p_broadcast_id: broadcast.id,
      p_processing_token: broadcast.processingToken,
    });
    if (finalizeError?.message.includes("BROADCAST_INCOMPLETE"))
      return {
        ok: false as const,
        code: "IN_PROGRESS" as const,
        message: "Broadcast belum selesai.",
      };
    if (finalizeError)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Broadcast belum selesai.",
      };
    const results = await getBroadcastHistory(client, broadcast.id);
    if (!results)
      return {
        ok: false as const,
        code: "UNAVAILABLE" as const,
        message: "Riwayat broadcast tidak tersedia.",
      };
    return {
      ok: true as const,
      broadcastId: broadcast.id,
      results,
      totals: groupBroadcastResults(results),
    };
  });
