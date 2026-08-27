import { createHash } from "node:crypto";

type BroadcastPayload = {
  actor: "super-admin";
  scope: "restaurant" | "all";
  restaurantId?: string;
  message: string;
};

export function canonicalBroadcastPayload(payload: BroadcastPayload) {
  return JSON.stringify({
    actor: payload.actor,
    scope: payload.scope,
    restaurantId: payload.scope === "restaurant" ? payload.restaurantId : null,
    message: payload.message.trim(),
  });
}

export function fingerprintBroadcastPayload(payload: string) {
  return createHash("sha256").update(payload).digest("hex");
}
