import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { AuthGate } from "@/components/AuthGate";
import { SoundboardGrid } from "@/components/SoundboardGrid";
import { RestaurantCredentialDialog } from "@/components/RestaurantCredentialDialog";
import type { TableStatus } from "@/components/TableButton";
import { getAuthStatus, loginSuperAdmin } from "@/lib/auth";
import {
  getRemoteAdminSnapshot,
  sendRemoteCommand,
  sendCrewMessage,
} from "@/lib/remote-audio.server";
import { listRestaurants } from "@/lib/restaurants.server";
import { listManifestItems, toggleManifestItem, upsertManifestItem } from "@/lib/manifest.server";
import { requestR2Upload } from "@/lib/upload.server";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import {
  commandStatus,
  getSelectedRemoteTarget,
  remoteCommandRequest,
  reconcileRemoteSelection,
} from "@/lib/super-admin-state";
import { CREW_MESSAGE_MAX_LENGTH, validateCrewMessageRequest } from "@/lib/crew-message-domain";
import type { AudioId } from "@/lib/remote-audio-domain";
import { createInvalidationDebouncer, realtimeIsReady } from "@/lib/super-admin-realtime";

const snapshotKey = ["remote-admin-snapshot"] as const;

export const Route = createFileRoute("/super-admin")({
  loader: () => getAuthStatus(),
  head: () => ({
    meta: [{ title: "Super Admin — Table Talker" }, { name: "robots", content: "noindex" }],
  }),
  component: SuperAdminRoute,
});

function SuperAdminRoute() {
  const auth = Route.useLoaderData();
  const router = useRouter();
  if (!auth.superAdmin) {
    return (
      <AuthGate
        onSuccess={() => router.invalidate()}
        title="Login Super Admin"
        instruction="Masukkan password khusus untuk remote audio."
        submitLabel="Masuk"
        loginAction={loginSuperAdmin}
      />
    );
  }
  return <SuperAdminPage />;
}

function SuperAdminPage() {
  const queryClient = useQueryClient();
  const [targetSessionId, setTargetSessionId] = useState("");
  const [sendError, setSendError] = useState("");
  const [messageText, setMessageText] = useState("");
  const [realtimeStatus, setRealtimeStatus] = useState("SUBSCRIBING");
  const [now, setNow] = useState(Date.now());
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: () => getRemoteAdminSnapshot(),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
  const mutation = useMutation({
    mutationFn: (request: { targetSessionId: string; audioId: AudioId }) =>
      sendRemoteCommand({ data: request }),
    onSuccess: () => {
      setSendError("");
      queryClient.invalidateQueries({ queryKey: snapshotKey });
    },
    onError: () => setSendError("Gagal mengirim perintah. Silakan coba lagi."),
  });
  const messageMutation = useMutation({
    mutationFn: sendCrewMessage,
    onSuccess: (result) => {
      if ("error" in result) {
        toast.error(result.error);
      } else if ("ok" in result) {
        toast.success("Pesan terkirim.");
        setMessageText("");
      } else {
        toast.error("Realtime offline");
      }
    },
    onError: () => toast.error("Gagal mengirim pesan."),
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const client = getSupabaseBrowserClient();
    if (!client) {
      setRealtimeStatus("CHANNEL_ERROR");
      return;
    }
    const invalidate = createInvalidationDebouncer(() =>
      queryClient.invalidateQueries({ queryKey: snapshotKey }),
    );
    const channel = client
      .channel("super-admin-remote-audio", { config: { private: false } })
      .on("broadcast", { event: "invalidate" }, invalidate)
      .subscribe((status) => setRealtimeStatus(status));
    return () => {
      invalidate.cancel();
      void client.removeChannel(channel);
    };
  }, [queryClient]);

  const data = snapshot.data;
  const offline = !data || data.offline || !realtimeIsReady(realtimeStatus);
  const sessions = useMemo(() => (data && !data.offline ? data.sessions : []), [data]);
  const catalog = useMemo(() => (data && !data.offline ? data.catalog : []), [data]);
  const commands = data && !data.offline ? data.commands : [];

  useEffect(() => {
    const nextTargetSessionId = reconcileRemoteSelection(
      targetSessionId,
      sessions.map((session) => ({
        id: session.id,
        state: session.state,
        eligible: session.eligible,
        audioReady: session.audio_ready,
      })),
    );
    if (nextTargetSessionId !== targetSessionId) setTargetSessionId(nextTargetSessionId);
  }, [sessions, targetSessionId]);

  const selectedTarget = getSelectedRemoteTarget(
    targetSessionId,
    sessions.map((session) => ({
      id: session.id,
      state: session.state,
      eligible: session.eligible,
      audioReady: session.audio_ready,
    })),
  );
  const controlsDisabled = true;
  const availableAudioIds = new Set<AudioId>();

  return (
    <main className="min-h-[100svh] bg-background px-4 py-6 sm:px-6">
      <section className="brutal-border brutal-shadow-lg mx-auto max-w-4xl bg-card p-4 sm:p-6">
        <h1 className="font-display text-xl uppercase sm:text-2xl">Super Admin Remote Audio</h1>
        {offline ? (
          <p
            role="status"
            className="brutal-border mt-4 bg-destructive px-3 py-2 text-sm font-bold text-destructive-foreground"
          >
            Realtime offline
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Kontrol remote dinonaktifkan sampai katalog manifest per resto tersedia.
          </p>
        )}
        <div className="mt-5">
          <label className="text-sm font-bold">
            Target crew
            <select
              value={targetSessionId}
              onChange={(event) => setTargetSessionId(event.target.value)}
              className="brutal-border mt-1 w-full bg-background px-3 py-2 font-normal"
              disabled={offline}
            >
              <option value="">Pilih crew</option>
              {sessions.map((session) => {
                const status =
                  session.state === "recent"
                    ? `Offline / terakhir aktif ${new Date(session.last_seen).toLocaleString("id-ID")}`
                    : session.audio_ready
                      ? "Online dan siap audio"
                      : "Aktifkan suara di perangkat";
                return (
                  <option key={session.id} value={session.id} disabled={!session.eligible}>
                    {session.display_name} — {session.device_description} — {status}
                  </option>
                );
              })}
            </select>
          </label>
        </div>
        {selectedTarget && (
          <p className="mt-2 text-xs text-muted-foreground">
            {selectedTarget.eligible && selectedTarget.audioReady
              ? "Online dan siap audio."
              : "Target tidak siap audio."}
          </p>
        )}
        {selectedTarget && selectedTarget.state === "online" && (
          <div className="mt-5">
            <label className="text-sm font-bold">
              Pesan ke{" "}
              {sessions.find((s) => s.id === targetSessionId)?.display_name ?? selectedTarget.id}
              <textarea
                className="brutal-border mt-1 w-full bg-background px-3 py-2 font-normal"
                maxLength={CREW_MESSAGE_MAX_LENGTH}
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                placeholder="Ketik pesan (maks 200 karakter)..."
                rows={3}
                disabled={messageMutation.isPending || offline}
              />
            </label>
            <button
              type="button"
              className="brutal-border brutal-press mt-2 w-full bg-accent px-3 py-2 font-display uppercase"
              disabled={
                !messageText.trim() ||
                messageMutation.isPending ||
                offline ||
                targetSessionId === ""
              }
              onClick={() => {
                const result = validateCrewMessageRequest({
                  targetSessionId,
                  message: messageText,
                });
                if ("error" in result) return toast.error(result.error);
                messageMutation.mutate({ data: result });
              }}
            >
              Kirim Pesan
            </button>
          </div>
        )}
        {(sendError || (mutation.data && "error" in mutation.data && mutation.data.error)) && (
          <p role="alert" className="mt-3 text-sm font-bold text-destructive">
            {sendError || (mutation.data && "error" in mutation.data ? mutation.data.error : "")}
          </p>
        )}
        <p className="mt-3 text-sm font-bold">
          Kontrol audio remote menunggu katalog manifest per resto.
        </p>
        <div className="mt-5">
          <SoundboardGrid
            availableAudioIds={availableAudioIds}
            drawerDisabled={controlsDisabled}
            tableDisabled={() => controlsDisabled}
            announcementDisabled={() => controlsDisabled}
            tableStatus={(tableNumber): TableStatus => {
              const audioId = `table:${tableNumber}` as AudioId;
              return mutation.isPending && mutation.variables.audioId === audioId
                ? "loading"
                : "ready";
            }}
            announcementStatus={(announcementId) => {
              const audioId = `announcement:${announcementId}` as AudioId;
              return mutation.isPending && mutation.variables.audioId === audioId
                ? "loading"
                : "idle";
            }}
            onSelect={(audioId) => {
              const request = remoteCommandRequest(selectedTarget, audioId);
              if (!request) return;
              setSendError("");
              mutation.reset();
              mutation.mutate(request);
            }}
          />
        </div>
      </section>
      <section
        className="brutal-border mx-auto mt-6 max-w-4xl bg-card p-4 sm:p-6"
        aria-labelledby="audit-heading"
      >
        <h2 id="audit-heading" className="font-display text-lg uppercase">
          Audit 7 Hari
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-xs sm:text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-2">Status</th>
                <th className="p-2">Actor</th>
                <th className="p-2">Target</th>
                <th className="p-2">Audio</th>
                <th className="p-2">Waktu</th>
                <th className="p-2">Alasan</th>
              </tr>
            </thead>
            <tbody>
              {commands.map((command) => {
                const target = sessions.find((session) => session.id === command.target_session_id);
                const audio = catalog.find((item) => item.id === command.audio_id);
                return (
                  <tr key={command.id} className="border-b align-top">
                    <td className="p-2 font-bold">{commandStatus(command, now)}</td>
                    <td className="p-2">{command.actor}</td>
                    <td className="p-2">{target?.display_name ?? command.target_session_id}</td>
                    <td className="p-2">{audio?.label ?? command.audio_id}</td>
                    <td className="p-2">{new Date(command.created_at).toLocaleString("id-ID")}</td>
                    <td className="p-2">{command.failure_reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!offline && commands.length === 0 && (
            <p className="py-4 text-sm text-muted-foreground">
              Belum ada perintah dalam 7 hari terakhir.
            </p>
          )}
        </div>
      </section>
      <AudioManagementSection />
    </main>
  );
}

function AudioManagementSection() {
  const queryClient = useQueryClient();
  const [selectedRestaurantId, setSelectedRestaurantId] = useState("");
  const [credentialDialog, setCredentialDialog] = useState<{
    mode: "create" | "view" | "rotate";
    restaurant?: { id: string; displayName: string };
  } | null>(null);
  const restaurantsQuery = useQuery({
    queryKey: ["restaurants-list"],
    queryFn: () => listRestaurants(),
  });
  const restaurants =
    restaurantsQuery.data && "ok" in restaurantsQuery.data && restaurantsQuery.data.ok
      ? restaurantsQuery.data.restaurants
      : [];

  return (
    <section className="brutal-border mx-auto mt-6 max-w-4xl bg-card p-4 sm:p-6">
      <h2 className="font-display text-lg uppercase">Audio Management</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Kelola audio manifest per resto. Upload file MP3 ke R2, atur label dan kategori.
      </p>
      <div className="mt-4">
        <button
          type="button"
          className="brutal-border brutal-press mb-4 bg-accent px-3 py-2 font-display"
          onClick={() => setCredentialDialog({ mode: "create" })}
        >
          Buat Resto
        </button>
        <label className="text-sm font-bold">
          Pilih Resto
          <select
            value={selectedRestaurantId}
            onChange={(e) => setSelectedRestaurantId(e.target.value)}
            className="brutal-border mt-1 w-full bg-background px-3 py-2 font-normal"
          >
            <option value="">Pilih resto</option>
            {restaurants.map(
              (r: { id: string; display_name: string; catalog_version: number | null }) => (
                <option key={r.id} value={r.id}>
                  {r.display_name} (v{r.catalog_version ?? 0})
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      <div className="mt-4 space-y-2" aria-label="Daftar resto">
        {restaurants.map((restaurant: { id: string; display_name: string }) => (
          <div
            key={restaurant.id}
            className="brutal-border flex flex-wrap items-center justify-between gap-2 p-2"
          >
            <span>
              {restaurant.display_name} <span className="font-mono text-xs">{restaurant.id}</span>
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                className="underline"
                onClick={() =>
                  setCredentialDialog({
                    mode: "view",
                    restaurant: { id: restaurant.id, displayName: restaurant.display_name },
                  })
                }
              >
                Lihat Kode
              </button>
              <button
                type="button"
                className="underline"
                onClick={() =>
                  setCredentialDialog({
                    mode: "rotate",
                    restaurant: { id: restaurant.id, displayName: restaurant.display_name },
                  })
                }
              >
                Ganti Kode
              </button>
            </span>
          </div>
        ))}
      </div>
      {selectedRestaurantId && (
        <ManifestItemsList
          restaurantId={selectedRestaurantId}
          onUploadComplete={() => queryClient.invalidateQueries({ queryKey: ["restaurants-list"] })}
        />
      )}
      {credentialDialog && (
        <RestaurantCredentialDialog
          open
          mode={credentialDialog.mode}
          restaurant={credentialDialog.restaurant}
          onOpenChange={(open) => !open && setCredentialDialog(null)}
          onComplete={() => queryClient.invalidateQueries({ queryKey: ["restaurants-list"] })}
        />
      )}
    </section>
  );
}

function ManifestItemsList({
  restaurantId,
  onUploadComplete,
}: {
  restaurantId: string;
  onUploadComplete: () => void;
}) {
  const queryClient = useQueryClient();
  const [audioId, setAudioId] = useState("");
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("BASE");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  const itemsQuery = useQuery({
    queryKey: ["manifest-items", restaurantId],
    queryFn: () => listManifestItems({ data: { restaurantId } }),
  });

  const items =
    itemsQuery.data && "ok" in itemsQuery.data && itemsQuery.data.ok ? itemsQuery.data.items : [];

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile || !audioId.trim() || !label.trim()) return;
      setUploading(true);
      setUploadError("");
      try {
        if (uploadFile.type !== "audio/mpeg") {
          setUploadError("File harus MP3.");
          return;
        }
        const buffer = await uploadFile.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", buffer);
        const contentHash = Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        const result = await requestR2Upload({
          data: {
            restaurantId,
            audioId: audioId.trim(),
            contentType: "audio/mpeg",
            byteSize: uploadFile.size,
            contentHash,
          },
        });
        if (!result || !("ok" in result) || !result.ok) {
          setUploadError("error" in result && result.error ? result.error : "Upload gagal.");
          return;
        }
        const response = await fetch(result.putUrl, {
          method: "PUT",
          headers: result.headers,
          body: uploadFile,
        });
        if (!response.ok) {
          setUploadError("Upload ke R2 gagal.");
          return;
        }
        const manifestResult = await upsertManifestItem({
          data: {
            restaurantId,
            audioId: audioId.trim(),
            label: label.trim(),
            category,
            r2Url: result.url,
            contentHash: result.hash,
            byteSize: result.byteSize,
            ordering: items.length,
          },
        });
        if (!manifestResult || !("ok" in manifestResult) || !manifestResult.ok) {
          setUploadError(
            "error" in manifestResult ? manifestResult.error : "Gagal simpan manifest.",
          );
          return;
        }
        setAudioId("");
        setLabel("");
        setUploadFile(null);
        onUploadComplete();
        queryClient.invalidateQueries({ queryKey: ["manifest-items", restaurantId] });
      } catch {
        setUploadError("Upload gagal.");
      } finally {
        setUploading(false);
      }
    },
  });

  return (
    <div className="mt-4 space-y-4">
      <div className="brutal-border bg-background p-3">
        <h3 className="text-sm font-bold">Upload Audio Baru</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input
            type="text"
            placeholder="Audio ID (misal: table:1)"
            value={audioId}
            onChange={(e) => setAudioId(e.target.value)}
            className="brutal-border bg-card px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Label (misal: Meja 1)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="brutal-border bg-card px-3 py-2 text-sm"
          />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="brutal-border bg-card px-3 py-2 text-sm"
          >
            <option value="BASE">BASE</option>
            <option value="INFO">INFO</option>
            <option value="LARANGAN">LARANGAN</option>
          </select>
          <input
            type="file"
            accept=".mp3,audio/mpeg"
            onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            className="brutal-border bg-card px-3 py-2 text-sm"
          />
        </div>
        {uploadError && <p className="mt-2 text-xs font-bold text-destructive">{uploadError}</p>}
        <button
          type="button"
          className="brutal-border brutal-press mt-2 w-full bg-accent px-3 py-2 font-display uppercase text-sm"
          disabled={!uploadFile || !audioId.trim() || !label.trim() || uploading}
          onClick={() => uploadMutation.mutate()}
        >
          {uploading ? "Mengupload..." : "Upload & Tambah ke Manifest"}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[500px] text-left text-xs sm:text-sm">
          <thead>
            <tr className="border-b">
              <th className="p-2">Audio ID</th>
              <th className="p-2">Label</th>
              <th className="p-2">Kategori</th>
              <th className="p-2">Status</th>
              <th className="p-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {items.map(
              (item: {
                id: string;
                audio_id: string;
                label: string;
                category: string;
                active: boolean;
              }) => (
                <tr key={item.id} className="border-b align-top">
                  <td className="p-2 font-mono text-xs">{item.audio_id}</td>
                  <td className="p-2">{item.label}</td>
                  <td className="p-2">{item.category}</td>
                  <td className="p-2">
                    <span className={item.active ? "text-green-600" : "text-muted-foreground"}>
                      {item.active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="p-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={async () => {
                        const result = await toggleManifestItem({
                          data: { restaurantId, audioId: item.audio_id, active: !item.active },
                        });
                        if (!result || !("ok" in result) || !result.ok) {
                          toast.error("error" in result ? result.error : "Gagal mengubah status.");
                          return;
                        }
                        onUploadComplete();
                        queryClient.invalidateQueries({
                          queryKey: ["manifest-items", restaurantId],
                        });
                      }}
                    >
                      {item.active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {items.length === 0 && (
          <p className="py-4 text-sm text-muted-foreground text-center">
            Belum ada audio di manifest ini.
          </p>
        )}
      </div>
    </div>
  );
}
