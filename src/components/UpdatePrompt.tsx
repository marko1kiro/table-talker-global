"use client";
// Poin 6.1 S5: modal wajib-konfirmasi (owner copy EXACT). "Refresh" reloads;
// "Nanti Aja" silences THIS build for the rest of the tab session — a NEW tab,
// a new login session on another tab, or a NEWER build after this dismissal
// will prompt again. No ESC, no overlay-click dismissal, no silent reload ever.
import { useEffect, useState } from "react";
import {
  DISMISS_PREFIX,
  PROBE_INTERVAL_MS,
  UPDATE_TEXT,
  currentIndexAsset,
  dismissedBuild,
  isChunkLoadError,
  parseIndexAsset,
  shouldPrompt,
} from "@/lib/update-prompt";

export function UpdatePrompt({ intervalMs = PROBE_INTERVAL_MS }: { intervalMs?: number }) {
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const current = currentIndexAsset();
    if (!current) return;
    // No stopped-flag: in-flight fetch resolving post-unmount only calls setPending, a React no-op after unmount — no AbortController needed.
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/?t=${Date.now()}`, { cache: "no-store" });
        const fetched = parseIndexAsset(await res.text());
        if (shouldPrompt(current, fetched, dismissedBuild(fetched))) setPending(fetched);
      } catch {
        /* WiFi kedip: diem total */
      }
    };
    void check();
    const id = setInterval(() => void check(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const message = String(
        (event.reason as { message?: unknown })?.message ?? event.reason ?? "",
      );
      if (isChunkLoadError(message)) void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [intervalMs]);
  if (!pending) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Update sistem"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
        <p className="text-base font-bold text-ta-gray-900">{UPDATE_TEXT}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white transition hover:bg-brand-600"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                sessionStorage.setItem(DISMISS_PREFIX + pending, "1");
              } catch {
                /* storage penuh: biarkan, jangan meledak */
              }
              setPending(null);
            }}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-ta-gray-200 bg-white text-sm font-bold text-ta-gray-700 transition hover:bg-ta-gray-50"
          >
            Nanti Aja
          </button>
        </div>
      </div>
    </div>
  );
}
