// Poin 6.1 S5: honest update detection for every role. No version.json, no
// build defines: the running page's own <script src="/assets/index-*.js"> is
// compared against the entry asset referenced by the CURRENT production HTML
// (fetched same-origin, cache-busted). Different file hash == different deploy.
export const UPDATE_TEXT = "Ada Update sistem, Tolong refresh halaman ya.";
export const DISMISS_PREFIX = "lm.update.dismissed.";
export const PROBE_INTERVAL_MS = 5 * 60_000;

const INDEX_ASSET_RE = /\/assets\/index-[A-Za-z0-9_-]+\.js/;

export function parseIndexAsset(html: string): string | null {
  return html.match(INDEX_ASSET_RE)?.[0] ?? null;
}

export function currentIndexAsset(): string | null {
  if (typeof document === "undefined") return null;
  for (const s of Array.from(document.querySelectorAll("script[src]"))) {
    const src = s.getAttribute("src") ?? "";
    const m = src.match(INDEX_ASSET_RE);
    if (m) return m[0];
  }
  return null;
}

export function dismissedBuild(asset: string | null): boolean {
  if (!asset || typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(DISMISS_PREFIX + asset) === "1";
}

export function shouldPrompt(
  current: string | null,
  fetched: string | null,
  isDismissed: boolean,
): boolean {
  return Boolean(current && fetched && current !== fetched && !isDismissed);
}

export function isChunkLoadError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed/i.test(message);
}
