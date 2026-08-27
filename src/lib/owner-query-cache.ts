export function isOwnerQueryKey(queryKey: readonly unknown[]) {
  return typeof queryKey[0] === "string" && queryKey[0].startsWith("owner-");
}
