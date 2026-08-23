import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import {
  deleteManifestItem,
  listManifestItems,
  reorderManifestItem,
  toggleManifestItem,
  upsertManifestItem,
} from "@/lib/manifest.server";
import { requestR2Upload } from "@/lib/upload.server";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/super-admin/audio")({
  validateSearch: (search: Record<string, unknown>) => ({
    restaurantId: typeof search.restaurantId === "string" ? search.restaurantId : "",
  }),
  component: Audio,
});
function Audio() {
  const { restaurantId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const [audioId, setAudioId] = useState("table:1");
  const [label, setLabel] = useState("Meja 1");
  const [category, setCategory] = useState("BASE");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });
  const manifest = useQuery({
    queryKey: ["manifest", restaurantId],
    queryFn: () => listManifestItems({ data: { restaurantId } }),
    enabled: !!restaurantId,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["manifest", restaurantId] });
    void qc.invalidateQueries({ queryKey: ["owner-restaurants"] });
    void qc.invalidateQueries({ queryKey: ["owner-restaurant", restaurantId] });
    void qc.invalidateQueries({ queryKey: ["owner-dashboard"] });
  };
  const upload = async () => {
    if (
      !file ||
      file.type !== "audio/mpeg" ||
      file.size < 1024 * 1024 ||
      file.size > 10 * 1024 * 1024
    )
      return setError("Pilih MP3 1-10 MB.");
    setPending(true);
    setError("");
    try {
      const hash = [
        ...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
      ]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const signed = await requestR2Upload({
        data: {
          restaurantId,
          audioId,
          contentType: "audio/mpeg",
          byteSize: file.size,
          contentHash: hash,
        },
      });
      if (!("ok" in signed) || !signed.ok) throw new Error("Upload tidak tersedia.");
      const put = await fetch(signed.putUrl, {
        method: "PUT",
        headers: signed.headers,
        body: file,
      });
      if (!put.ok) throw new Error("Upload gagal.");
      const saved = await upsertManifestItem({
        data: {
          restaurantId,
          audioId,
          label,
          category,
          r2Url: signed.url,
          contentHash: hash,
          byteSize: file.size,
          ordering: 0,
        },
      });
      if (!("ok" in saved) || !saved.ok) throw new Error("Katalog tidak tersimpan.");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload gagal.");
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="brutal-border bg-card p-6">
      <h1 className="font-display text-2xl uppercase">Audio</h1>
      <select
        aria-label="Resto"
        value={restaurantId}
        onChange={(event) => void navigate({ search: { restaurantId: event.target.value } })}
      >
        <option value="">Pilih resto</option>
        {restaurants.data?.ok &&
          (restaurants.data.restaurants as Array<{ id: string; display_name: string }>).map(
            (restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>
                {restaurant.display_name}
              </option>
            ),
          )}
      </select>
      {restaurantId && (
        <>
          <div className="mt-4">
            <input value={audioId} onChange={(event) => setAudioId(event.target.value)} />
            <input value={label} onChange={(event) => setLabel(event.target.value)} />
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
            <input
              aria-label="File MP3"
              type="file"
              accept="audio/mpeg,.mp3"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <button type="button" disabled={pending} onClick={() => void upload()}>
              {pending ? "Mengunggah..." : "Simpan MP3"}
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
          {manifest.isLoading ? (
            <p>Memuat katalog...</p>
          ) : manifest.data && "items" in manifest.data ? (
            <ul>
              {manifest.data.items.map(
                (item: { audio_id: string; label: string; active: boolean; ordering: number }) => (
                  <li key={item.audio_id}>
                    {item.label}{" "}
                    <button
                      type="button"
                      onClick={() =>
                        void toggleManifestItem({
                          data: { restaurantId, audioId: item.audio_id, active: !item.active },
                        }).then(refresh)
                      }
                    >
                      {item.active ? "Nonaktifkan" : "Aktifkan"}
                    </button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button type="button">Hapus</button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle>Hapus audio?</AlertDialogTitle>
                        <AlertDialogAction
                          onClick={() =>
                            void deleteManifestItem({
                              data: { restaurantId, audioId: item.audio_id },
                            }).then(refresh)
                          }
                        >
                          Hapus
                        </AlertDialogAction>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                      </AlertDialogContent>
                    </AlertDialog>
                    <button
                      type="button"
                      onClick={() =>
                        void reorderManifestItem({
                          data: {
                            restaurantId,
                            audioId: item.audio_id,
                            ordering: item.ordering - 1,
                          },
                        }).then(refresh)
                      }
                    >
                      Naik
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void reorderManifestItem({
                          data: {
                            restaurantId,
                            audioId: item.audio_id,
                            ordering: item.ordering + 1,
                          },
                        }).then(refresh)
                      }
                    >
                      Turun
                    </button>
                  </li>
                ),
              )}
            </ul>
          ) : (
            <p role="alert">Katalog tidak dapat dimuat.</p>
          )}
        </>
      )}
    </section>
  );
}
