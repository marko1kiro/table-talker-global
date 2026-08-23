"use client";

import { useEffect, useRef, useState } from "react";
import { getRestaurantManifest } from "@/lib/restaurants.server";
import { captureError } from "@/lib/error-capture";
import {
  type SyncProgress,
  type SyncResult,
  createSyncRunGate,
  syncManifest,
} from "@/lib/audio-sync";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Loader2, Wifi, WifiOff } from "lucide-react";

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

export function SyncDialog({ restaurantId, tenantToken, onSynced, onSessionInvalid }: SyncDialogProps) {
  const [state, setState] = useState<SyncState>({ phase: "idle" });
  const runGateRef = useRef(createSyncRunGate());
  const failedManifestRef = useRef<Set<string> | null>(null);

  const reportSyncError = (reportCode: string, detail: string) => {
    void captureError({ stage: "sync_cache", reportCode, detail, tenantToken });
  };

  const runSync = async () => {
    const runId = runGateRef.current.start();
    setState({ phase: "fetching" });

    try {
      const res = await getRestaurantManifest({ data: { restaurantId, tenantToken } });

      if (isOfflineResult(res)) {
        reportSyncError("SYNC_OFFLINE", res.message);
        setState({ phase: "error", message: "Tidak dapat terhubung ke server.", failedIds: [], reportCode: "SYNC_OFFLINE" });
        return;
      }

      if (!res.ok || !res.manifest) {
        if ("error" in res && res.error === "Sesi resto tidak valid.") onSessionInvalid();
        reportSyncError("SYNC_MANIFEST", "Manifest request failed.");
        setState({ phase: "error", message: "Gagal memuat manifest audio.", failedIds: [], reportCode: "SYNC_MANIFEST" });
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
      setState({ phase: "syncing", progress: { current: 0, total: syncItems.length, label: "Memulai..." } });

      const result = await syncManifest(
        restaurantId,
        syncItems,
        (progress: SyncProgress) => {
          if (runGateRef.current.isCurrent(runId)) {
            setState({ phase: "syncing", progress });
          }
        },
      );

      if (!runGateRef.current.isCurrent(runId)) return;

      if (result.ok) {
        failedManifestRef.current = null;
        setState({ phase: "done", result });
        onSynced(res.manifest.map(({ audioId }) => audioId));
      } else {
        failedManifestRef.current = new Set(result.failedIds);
        const reportCode = result.message?.includes("Cache Storage") || result.message?.includes("Web Crypto")
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
        reportSyncError("SYNC_MANIFEST", error instanceof Error ? error.message : "Unknown sync error.");
        setState({ phase: "error", message: "Terjadi kesalahan.", failedIds: [], reportCode: "SYNC_MANIFEST" });
      }
    }
  };

  useEffect(() => {
    failedManifestRef.current = null;
    runSync();
    return () => {
      runGateRef.current.cancel();
    };
  }, [restaurantId, tenantToken]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-sm mx-4">
        <CardContent className="p-6 space-y-4">
          {state.phase === "fetching" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Memuat manifest audio...</p>
            </div>
          )}

          {state.phase === "syncing" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-primary" />
                <p className="text-sm font-medium">Sinkronisasi Audio</p>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{state.progress.label}</span>
                  <span>
                    {state.progress.current}/{state.progress.total}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{
                      width: `${state.progress.total > 0 ? (state.progress.current / state.progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Jangan tutup aplikasi selama sinkronisasi
              </p>
            </div>
          )}

          {state.phase === "done" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Wifi className="h-8 w-8 text-green-500" />
              <p className="text-sm font-medium">Audio siap digunakan</p>
            </div>
          )}

          {state.phase === "error" && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <WifiOff className="h-4 w-4 text-destructive" />
                <p className="text-sm font-medium">Sinkronisasi Gagal</p>
              </div>
               <p className="text-sm text-muted-foreground">{state.message}</p>
               <p className="text-xs text-muted-foreground">Laporan: {state.reportCode}</p>
              <Button onClick={runSync} className="w-full" size="sm">
                Coba Lagi
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
