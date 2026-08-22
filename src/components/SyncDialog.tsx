"use client";

import { useEffect, useRef, useState } from "react";
import { getRestaurantManifest } from "@/lib/restaurants.server";
import {
  type SyncProgress,
  type SyncResult,
  syncManifest,
} from "@/lib/audio-sync";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Loader2, Wifi, WifiOff } from "lucide-react";

type SyncDialogProps = {
  restaurantId: string;
  onSynced: () => void;
};

type SyncState =
  | { phase: "idle" }
  | { phase: "fetching" }
  | { phase: "syncing"; progress: SyncProgress }
  | { phase: "done"; result: SyncResult }
  | { phase: "error"; message: string; failedIds: string[] };

function isOfflineResult(data: unknown): data is { offline: true; message: string } {
  return typeof data === "object" && data !== null && "offline" in data;
}

export function SyncDialog({ restaurantId, onSynced }: SyncDialogProps) {
  const [state, setState] = useState<SyncState>({ phase: "idle" });
  const abortRef = useRef(false);

  const runSync = async () => {
    abortRef.current = false;
    setState({ phase: "fetching" });

    try {
      const res = await getRestaurantManifest({ data: { restaurantId } });

      if (isOfflineResult(res)) {
        setState({ phase: "error", message: "Tidak dapat terhubung ke server.", failedIds: [] });
        return;
      }

      if (!res.ok || !res.manifest) {
        setState({ phase: "error", message: "Gagal memuat manifest audio.", failedIds: [] });
        return;
      }

      if (res.manifest.length === 0) {
        setState({ phase: "done", result: { ok: true, cachedCount: 0, downloadedCount: 0, failedIds: [] } });
        onSynced();
        return;
      }

      setState({ phase: "syncing", progress: { current: 0, total: res.manifest.length, label: "Memulai..." } });

      const result = await syncManifest(
        res.manifest,
        (progress: SyncProgress) => {
          if (!abortRef.current) {
            setState({ phase: "syncing", progress });
          }
        },
      );

      if (abortRef.current) return;

      if (result.ok) {
        setState({ phase: "done", result });
        onSynced();
      } else {
        setState({
          phase: "error",
          message: `${result.failedIds.length} audio gagal diunduh.`,
          failedIds: result.failedIds,
        });
      }
    } catch {
      if (!abortRef.current) {
        setState({ phase: "error", message: "Terjadi kesalahan.", failedIds: [] });
      }
    }
  };

  useEffect(() => {
    runSync();
    return () => {
      abortRef.current = true;
    };
  }, [restaurantId]);

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
