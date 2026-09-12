// Append-only administrative audit helper. All writes go through the
// write_admin_audit security-definer RPC (service client) — the underlying
// table has UPDATE/DELETE revoked from every role. NEVER pass passwords,
// candidate verifiers, tokens, or cookies as reason/metadata.
import { getServiceClient } from "./remote-audio.server";
import type { StaffKind } from "./staff-identity.server";

export type AdminAuditInput = {
  actorKind: StaffKind | "system" | "legacy_bootstrap";
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  targetKind?: string | null;
  targetId?: string | null;
  restaurantId?: string | null;
  result?: "ok" | "denied" | "failed";
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

export async function writeAdminAudit(input: AdminAuditInput): Promise<boolean> {
  const client = getServiceClient();
  if (!client) return false;
  const { error } = await client.rpc("write_admin_audit", {
    p_actor_kind: input.actorKind,
    p_actor_id: input.actorId ?? null,
    p_actor_label: input.actorLabel ?? null,
    p_action: input.action,
    p_target_kind: input.targetKind ?? null,
    p_target_id: input.targetId ?? null,
    p_restaurant_id: input.restaurantId ?? null,
    p_result: input.result ?? "ok",
    p_reason: input.reason ?? null,
    p_metadata: input.metadata ?? {},
  });
  return !error;
}
