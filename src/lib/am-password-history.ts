export type AuditLike = { action: string; restaurant_id: string | null };

export function selectResetDecisions<T extends AuditLike>(entries: T[], restoId: string | null): T[] {
  return entries.filter(
    (e) => e.action === "manager_reset.decide" && (!restoId || e.restaurant_id === restoId),
  );
}
