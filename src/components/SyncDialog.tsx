"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRestaurantManifest } from "@/lib/restaurants.server";
import { captureError } from "@/lib/error-capture";
import {
  type SyncProgress,
  type SyncResult,
  createSyncRunGate,
  syncManifest,
} from "@/lib/audio-sync";
import { Button } from "./ui/button";
import { CheckCircle2, Loader2, Wifi, WifiOff } from "lucide-react";

type SyncDialogProps = {
  restaurantId: string;
  tenantToken: string;
  onSynced: (audioIds: string[]) => void;
  onSessionInvalid: () => void;
};

type SyncState =
  | { phase: "idle" }
  | { phase: "fetching" }
  | { phase: "syncing"; progress: SyncProgress }
  | { phase: "done"; result: SyncResult }
  | { phase: "error"; message: string; failedIds: string[]; reportCode: string };

function isOfflineResult(data: unknown): data is { offline: true; message: string } {
  return typeof data === "object" && data !== null && "offline" in data;
}

export function SyncDialog({
  restaurantId,
  tenantToken,
  onSynced,
  onSessionInvalid,
}: SyncDialogProps) {
  const [state, setState] = useState<SyncState>({ phase: "idle" });
  const runGateRef = useRef(createSyncRunGate());
  const failedManifestRef = useRef<Set<string> | null>(null);

  const reportSyncError = useCallback(
    (reportCode: string, detail: string) => {
      void captureError({ stage: "sync_cache", reportCode, detail, tenantToken });
    },
    [tenantToken],
  );

  const runSync = useCallback(async () => {
    const runId = runGateRef.current.start();
    setState({ phase: "fetching" });

    try {
      const res = await getRestaurantManifest({ data: { restaurantId, tenantToken } });

      if (isOfflineResult(res)) {
        reportSyncError("SYNC_OFFLINE", res.message);
        setState({
          phase: "error",
          message: "Tidak dapat terhubung ke server.",
          failedIds: [],
          reportCode: "SYNC_OFFLINE",
        });
        return;
      }

      if (!res.ok || !res.manifest) {
        if ("error" in res && res.error === "Sesi resto tidak valid.") onSessionInvalid();
        reportSyncError("SYNC_MANIFEST", "Manifest request failed.");
        setState({
          phase: "error",
          message: "Gagal memuat manifest audio.",
          failedIds: [],
          reportCode: "SYNC_MANIFEST",
        });
        return;
      }

      if (res.manifest.length === 0) {
        setState({
          phase: "error",
          message: "Manifest audio kosong. Hubungi admin restoran.",
          failedIds: [],
          reportCode: "SYNC_MANIFEST",
        });
        reportSyncError("SYNC_MANIFEST", "Manifest is empty.");
        return;
      }

      const manifest = failedManifestRef.current
        ? res.manifest.filter(({ audioId }) => failedManifestRef.current?.has(audioId))
        : res.manifest;
      if (manifest.length === 0) failedManifestRef.current = null;
      const syncItems = manifest.length > 0 ? manifest : res.manifest;
      setState({
        phase: "syncing",
        progress: { current: 0, total: syncItems.length, label: "Memulai..." },
      });

      const result = await syncManifest(restaurantId, syncItems, (progress: SyncProgress) => {
        if (runGateRef.current.isCurrent(runId)) {
          setState({ phase: "syncing", progress });
        }
      });

      if (!runGateRef.current.isCurrent(runId)) return;

      if (result.ok) {
        failedManifestRef.current = null;
        setState({ phase: "done", result });
        onSynced(res.manifest.map(({ audioId }) => audioId));
      } else {
        failedManifestRef.current = new Set(result.failedIds);
        const reportCode =
          result.message?.includes("Cache Storage") || result.message?.includes("Web Crypto")
            ? "SYNC_CACHE"
            : "SYNC_DOWNLOAD";
        reportSyncError(reportCode, result.message ?? result.failedIds.join(","));
        setState({
          phase: "error",
          message: result.message ?? `${result.failedIds.length} audio gagal diunduh.`,
          failedIds: result.failedIds,
          reportCode,
        });
      }
    } catch (error) {
      if (runGateRef.current.isCurrent(runId)) {
        reportSyncError(
          "SYNC_MANIFEST",
          error instanceof Error ? error.message : "Unknown sync error.",
        );
        setState({
          phase: "error",
          message: "Terjadi kesalahan.",
          failedIds: [],
          reportCode: "SYNC_MANIFEST",
        });
      }
    }
  }, [onSessionInvalid, onSynced, reportSyncError, restaurantId, tenantToken]);

  useEffect(() => {
    const runGate = runGateRef.current;
    failedManifestRef.current = null;
    void runSync();
    return () => {
      runGate.cancel();
    };
  }, [runSync]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-brutal-fg/60 p-4 backdrop-blur-sm animate-in fade-in-0 duration-200">
      <div className="brutal-border brutal-shadow-lg w-full max-w-sm animate-in zoom-in-95 fade-in-0 rounded-none bg-card duration-300">
        <div className="space-y-4 p-6">
          {state.phase === "fetching" && (
            <div className="flex flex-col items-center gap-4 py-4">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                <span className="brutal-border absolute inset-0 rounded-full bg-background" />
                <Loader2 className="relative h-8 w-8 animate-spin text-primary" strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <p className="text-sm font-bold">Memuat manifest audio...</p>
                <p className="mt-2 flex items-center justify-center gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                </p>
              </div>
            </div>
          )}

          {state.phase === "syncing" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-6 w-6 items-center justify-center">
                  <span className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
                  <Wifi className="relative h-4 w-4 animate-pulse text-primary" strokeWidth={2.5} />
                </span>
                <p className="text-sm font-bold">Sinkronisasi Audio</p>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span className="truncate">{state.progress.label}</span>
                  <span className="tabular-nums font-bold text-foreground">
                    {state.progress.current}/{state.progress.total}
                  </span>
                </div>
                <div className="brutal-border h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="brutal-shimmer h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                    style={{
                      width: `${state.progress.total > 0 ? (state.progress.current / state.progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <p className="animate-pulse text-center text-xs font-medium text-muted-foreground">
                Jangan tutup aplikasi selama sinkronisasi
              </p>
            </div>
          )}

          {state.phase === "done" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="relative flex h-16 w-16 items-center justify-center">
                <span className="absolute inset-0 rounded-full bg-brutal-success/25 animate-ping" />
                <CheckCircle2
                  className="brutal-pop-in relative h-10 w-10 text-brutal-success"
                  strokeWidth={2.5}
                />
              </div>
              <p className="text-sm font-bold">Audio siap digunakan</p>
            </div>
          )}

          {state.phase === "error" && (
            <div className="space-y-3">
              <div className="brutal-shake flex items-center gap-2">
                <WifiOff className="h-4 w-4 text-destructive" strokeWidth={2.5} />
                <p className="text-sm font-bold">Sinkronisasi Gagal</p>
              </div>
              <p className="text-sm text-muted-foreground">{state.message}</p>
              <p className="text-xs text-muted-foreground">Laporan: {state.reportCode}</p>
              <Button
                onClick={runSync}
                variant="ghost"
                size="sm"
                className="brutal-border brutal-shadow brutal-press w-full rounded-none bg-accent font-bold text-accent-foreground hover:bg-accent"
              >
                Coba Lagi
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
