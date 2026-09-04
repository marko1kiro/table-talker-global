// Compact crew-header restaurant label: "{CODE} - {BRANCH}" where BRANCH drops a
// leading "Mie Gacoan" chain prefix. Casing is left to the header's uppercase
// class. Falls back to the full display name if stripping would empty it.
export function formatRestaurantLabel(code: string, displayName: string): string {
  const trimmed = (displayName ?? "").trim();
  const branch = trimmed.replace(/^\s*mie\s+gacoan\s+/i, "").trim() || trimmed;
  const c = (code ?? "").trim();
  return c ? `${c} - ${branch}` : branch;
}
