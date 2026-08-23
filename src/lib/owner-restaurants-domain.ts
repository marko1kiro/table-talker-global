import { ANNOUNCEMENT_CATALOG } from "./remote-audio-domain";

export type CatalogItemInput = { audioId: string; label: string; category: string };
export type CatalogMutationInput = CatalogItemInput & {
  r2Url: string;
  contentHash: string;
  byteSize: number;
  ordering: number;
};
export type OwnerResultCode = "INVALID_AUDIO_ID" | "INVALID_METADATA" | "UNAVAILABLE" | "NOT_FOUND";

export function isOwnerCatalogAudioId(audioId: string): boolean {
  return (
    /^table:(?:[1-9]|[1-9][0-9]|100)$/.test(audioId) ||
    ANNOUNCEMENT_CATALOG.some((item) => audioId === `announcement:${item.id}`) ||
    /^custom:[a-z0-9][a-z0-9_-]{0,99}$/.test(audioId)
  );
}

export function validateCatalogMutation(
  input: CatalogMutationInput,
): { ok: true; item: CatalogMutationInput } | { ok: false; code: OwnerResultCode } {
  const item = validateCatalogItem(input);
  if ("code" in item) return { ok: false, code: item.code };
  if (
    !/^https:\/\/.+/.test(input.r2Url) ||
    !/^[0-9a-f]{64}$/.test(input.contentHash) ||
    !Number.isInteger(input.byteSize) ||
    input.byteSize < 1024 * 1024 ||
    input.byteSize > 10 * 1024 * 1024 ||
    !Number.isInteger(input.ordering) ||
    input.ordering < 0
  )
    return { ok: false, code: "INVALID_METADATA" };
  return { ok: true, item: { ...input, label: item.label, category: item.category } };
}

export function validateCatalogItem(
  input: CatalogItemInput,
): CatalogItemInput | { code: OwnerResultCode } {
  if (!isOwnerCatalogAudioId(input.audioId)) return { code: "INVALID_AUDIO_ID" };
  const label = input.label.trim();
  const category = input.category.trim();
  if (!label || label.length > 200 || !category || category.length > 60)
    return { code: "INVALID_METADATA" };
  return { ...input, label, category };
}
