// @vitest-environment jsdom
// Poin 7 Task 2: SyncDialog decides the mode. Offline + snapshot => calls
// onOfflineReady + onSynced(snapshot ids) WITHOUT blocking; offline WITHOUT
// snapshot => legacy error; manifest ok => reports version via onManifestFresh.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const getRestaurantManifest = vi.fn();
const syncManifest = vi.fn();

vi.mock("@/lib/restaurants.server", () => ({
  getRestaurantManifest: (a: unknown) => getRestaurantManifest(a),
}));
vi.mock("@/lib/audio-sync", () => ({
  createSyncRunGate: () => {
    let n = 0;
    return { start: () => ++n, isCurrent: (id: number) => id === n, cancel: () => ++n };
  },
  syncManifest: (...a: unknown[]) => syncManifest(...a),
}));
vi.mock("@/lib/error-capture", () => ({ captureError: vi.fn(() => Promise.resolve()) }));

import { SyncDialog } from "../src/components/SyncDialog";

const SNAP = {
  restaurantId: "resto-1",
  catalogVersion: 12,
  fetchedAt: 1_000_000,
  items: [{ audioId: "table:1", hash: "h1", size: 10 }],
};

const MANIFEST = {
  ok: true as const,
  version: 12,
  manifest: [
    {
      audioId: "table:1",
      contentHash: "h1",
      byteSize: 10,
      label: "Meja 1",
      downloadUrl: "u",
      downloadGrant: "g",
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  getRestaurantManifest.mockReset();
  syncManifest.mockReset();
});

describe("offline fallback", () => {
  it("fetch gagal + ada snapshot => onOfflineReady + onSynced ids snapshot, tanpa error", async () => {
    getRestaurantManifest.mockRejectedValue(new TypeError("offline"));
    const onOfflineReady = vi.fn();
    const onSynced = vi.fn();
    const onManifestFresh = vi.fn();
    render(
      <SyncDialog
        restaurantId="resto-1"
        tenantToken="tok"
        fallbackSnapshot={SNAP}
        onOfflineReady={onOfflineReady}
        onManifestFresh={onManifestFresh}
        onSynced={onSynced}
        onSessionInvalid={vi.fn()}
        manifestTimeoutMs={0}
      />,
    );
    await waitFor(() => expect(onOfflineReady).toHaveBeenCalledWith(SNAP));
    expect(onSynced).toHaveBeenCalledWith(["table:1"]);
    expect(syncManifest).not.toHaveBeenCalled();
    expect(screen.queryByText("Sinkronisasi Gagal")).toBeNull();
    expect(onManifestFresh).not.toHaveBeenCalled();
  });

  it("fetch gagal + TANPA snapshot => error lama (blocking first-ever dipertahankan)", async () => {
    getRestaurantManifest.mockRejectedValue(new TypeError("offline"));
    const onOfflineReady = vi.fn();
    const onSynced = vi.fn();
    render(
      <SyncDialog
        restaurantId="resto-1"
        tenantToken="tok"
        onOfflineReady={onOfflineReady}
        onSynced={onSynced}
        onSessionInvalid={vi.fn()}
        manifestTimeoutMs={0}
      />,
    );
    await waitFor(() => expect(screen.queryByText("Sinkronisasi Gagal")).not.toBeNull());
    expect(onOfflineReady).not.toHaveBeenCalled();
    expect(onSynced).not.toHaveBeenCalled();
  });

  it("manifest ok => lapor versi via onManifestFresh lalu sync normal", async () => {
    getRestaurantManifest.mockResolvedValue(MANIFEST);
    syncManifest.mockResolvedValue({ ok: true, cachedCount: 1, downloadedCount: 0, failedIds: [] });
    const onManifestFresh = vi.fn();
    const onSynced = vi.fn();
    render(
      <SyncDialog
        restaurantId="resto-1"
        tenantToken="tok"
        onManifestFresh={onManifestFresh}
        onSynced={onSynced}
        onSessionInvalid={vi.fn()}
        manifestTimeoutMs={0}
      />,
    );
    await waitFor(() =>
      expect(onManifestFresh).toHaveBeenCalledWith({ version: 12, items: MANIFEST.manifest }),
    );
    await waitFor(() => expect(onSynced).toHaveBeenCalledWith(["table:1"]));
  });
});
