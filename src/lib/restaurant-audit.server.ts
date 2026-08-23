import { redactCredentialAudit } from "./restaurant-code.server";

export function serializeRestaurantCredentialAudit(value: unknown): string {
  return JSON.stringify(redactCredentialAudit(value));
}

export async function writeRestaurantCredentialAudit(
  client: any,
  value: {
    restaurantId: string;
    operation: "created" | "viewed" | "rotated" | "deactivated";
    success: boolean;
    reason?: string;
  },
) {
  await client.from("restaurant_credential_audit").insert({
    restaurant_id: value.restaurantId,
    operation: value.operation,
    success: value.success,
    reason_category: value.reason ?? null,
  });
}
