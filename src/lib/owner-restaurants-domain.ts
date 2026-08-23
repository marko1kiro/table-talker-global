import { ANNOUNCEMENT_CATALOG } from "./remote-audio-domain";

export type CatalogItemInput = { audioId: string; label: string; category: string };
export type OwnerResultCode = "INVALID_AUDIO_ID" | "INVALID_METADATA" | "UNAVAILABLE" | "NOT_FOUND";

export function isOwnerCatalogAudioId(audioId: string): boolean {
  return (
    /^table:(?:[1-9]|[1-9][0-9]|100)$/.test(audioId) ||
    ANNOUNCEMENT_CATALOG.some((item) => audioId === `announcement:${item.id}`) ||
    /^custom:[a-z0-9][a-z0-9_-]{0,99}$/.test(audioId)
  );
}

export function validateCatalogItem(
  input: CatalogItemInput,
): CatalogItemInput | { code: OwnerResultCode } {
  if (!isOwnerCatalogAudioId(input.audioId)) return { code: "INVALID_AUDIO_ID" };
  const label = input.label.trim();
  if (!label || label.length > 200 || !input.category.trim() || input.category.length > 60)
    return { code: "INVALID_METADATA" };
  return { ...input, label };
}
