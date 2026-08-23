import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ALL_CONFIRMATION } from "@/lib/owner-broadcast-domain";
import { previewOwnerBroadcast, sendOwnerBroadcast } from "@/lib/owner-broadcast.server";
import { CREW_MESSAGE_MAX_LENGTH } from "@/lib/crew-message-domain";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";

export const Route = createFileRoute("/super-admin/broadcast")({ component: Broadcast });

function Broadcast() {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"restaurant" | "all">("restaurant");
  const [restaurantId, setRestaurantId] = useState("");
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewOwnerBroadcast>> | null>(
    null,
  );
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendOwnerBroadcast>> | null>(null);
  const [error, setError] = useState("");
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });
  const previewMutation = useMutation({
    mutationFn: () =>
      previewOwnerBroadcast({
        data: { scope, restaurantId: scope === "restaurant" ? restaurantId : undefined },
      }),
    onSuccess: (data) => {
      setPreview(data);
      setResult(null);
      setError(data.ok ? "" : data.message);
    },
    onError: () => setError("Preview broadcast gagal."),
  });
  const sendMutation = useMutation({
    mutationFn: () =>
      sendOwnerBroadcast({
        data: {
          scope,
          restaurantId: scope === "restaurant" ? restaurantId : undefined,
          message,
          confirmation: scope === "all" ? confirmation : undefined,
        },
      }),
    onSuccess: async (data) => {
      setResult(data);
      setError(data.ok ? "" : data.message);
      if (data.ok)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] }),
          queryClient.invalidateQueries({ queryKey: ["owner-history"] }),
        ]);
    },
    onError: () => setError("Broadcast gagal dikirim."),
  });
  const canSend =
    preview?.ok &&
    message.trim().length > 0 &&
    message.length <= CREW_MESSAGE_MAX_LENGTH &&
    (scope !== "all" || confirmation === ALL_CONFIRMATION);

  return (
    <section className="space-y-4">
      <header>
        <h1 className="font-display text-2xl uppercase">Broadcast</h1>
        <p>Kirim pesan ke semua perangkat crew aktif.</p>
      </header>
      <div className="brutal-border space-y-3 bg-card p-4">
        <label>
          Target
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as "restaurant" | "all");
              setPreview(null);
              setConfirmation("");
            }}
          >
            <option value="restaurant">Satu resto</option>
            <option value="all">Semua resto aktif</option>
          </select>
        </label>
        {scope === "restaurant" && (
          <label>
            Resto
            <select
              value={restaurantId}
              onChange={(event) => {
                setRestaurantId(event.target.value);
                setPreview(null);
              }}
            >
              <option value="">Pilih resto</option>
              {restaurants.data?.ok &&
                restaurants.data.restaurants.map(
                  (restaurant: { id: string; display_name: string }) => (
                    <option key={restaurant.id} value={restaurant.id}>
                      {restaurant.display_name}
                    </option>
                  ),
                )}
            </select>
          </label>
        )}
        <label>
          Pesan
          <textarea
            value={message}
            maxLength={CREW_MESSAGE_MAX_LENGTH}
            onChange={(event) => {
              setMessage(event.target.value);
              setPreview(null);
            }}
          />
        </label>
        <p>
          {message.length}/{CREW_MESSAGE_MAX_LENGTH}
        </p>
        <button
          type="button"
          disabled={previewMutation.isPending || (scope === "restaurant" && !restaurantId)}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? "Memuat..." : "Preview target"}
        </button>
        {preview?.ok && (
          <div role="status">
            <p>
              {preview.restaurantCount} resto · {preview.deviceCount} perangkat aktif
            </p>
            <ul>
              {preview.restaurants.map((restaurant) => (
                <li key={restaurant.restaurantId}>
                  {restaurant.displayName}: {restaurant.deviceCount}
                </li>
              ))}
            </ul>
          </div>
        )}
        {scope === "all" && preview?.ok && (
          <label>
            Ketik {ALL_CONFIRMATION}
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          </label>
        )}
        <button
          type="button"
          disabled={!canSend || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
        >
          {sendMutation.isPending ? "Mengirim..." : "Kirim broadcast"}
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
      {result?.ok && (
        <div className="brutal-border bg-card p-4">
          <h2 className="font-display uppercase">Hasil per resto</h2>
          {result.totals.partial && <p role="status">Sebagian target gagal.</p>}
          <ul>
            {result.results.map((row) => (
              <li key={row.restaurantId}>
                {row.displayName}: {row.delivered} terkirim, {row.failed} gagal, {row.rejected}{" "}
                ditolak, {row.expired} kedaluwarsa
              </li>
            ))}
          </ul>
          <Link to="/super-admin/history">Lihat Riwayat Broadcast</Link>
        </div>
      )}
    </section>
  );
}
