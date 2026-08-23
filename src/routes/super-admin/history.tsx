import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { listOwnerHistory } from "@/lib/owner-history.server";
import { normalizeHistoryRange } from "@/lib/owner-history-domain";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";

export const Route = createFileRoute("/super-admin/history")({ component: History });

const dateInput = (date: Date) => date.toISOString().slice(0, 10);

function History() {
  const now = useMemo(() => new Date(), []);
  const initial = normalizeHistoryRange({}, now);
  const [restaurantId, setRestaurantId] = useState("");
  const [type, setType] = useState<"playback" | "sync">("playback");
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState(initial.ok ? initial.from.slice(0, 10) : dateInput(now));
  const [to, setTo] = useState(initial.ok ? initial.to.slice(0, 10) : dateInput(now));
  const [page, setPage] = useState(1);
  const range = normalizeHistoryRange(
    { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` },
    now,
  );
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });
  const history = useQuery({
    queryKey: ["owner-history", restaurantId, type, status, text, from, to, page],
    queryFn: () =>
      listOwnerHistory({
        data: {
          restaurantId: restaurantId || undefined,
          type,
          status: status || undefined,
          text: text || undefined,
          from: `${from}T00:00:00.000Z`,
          to: `${to}T23:59:59.999Z`,
          page,
        },
      }),
    enabled: range.ok,
  });
  const rows = history.data?.ok ? history.data.rows : [];

  return (
    <section className="space-y-4">
      <header>
        <h1 className="font-display text-2xl uppercase">Riwayat</h1>
        <p>Default 7 hari terakhir, maksimal 30 hari.</p>
      </header>
      <div className="brutal-border grid gap-3 bg-card p-4 md:grid-cols-3">
        <label>
          Resto
          <select
            value={restaurantId}
            onChange={(event) => {
              setRestaurantId(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua resto</option>
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
        <label>
          Jenis
          <select
            value={type}
            onChange={(event) => {
              setType(event.target.value as "playback" | "sync");
              setStatus("");
              setPage(1);
            }}
          >
            <option value="playback">Playback</option>
            <option value="sync">Sinkronisasi</option>
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua</option>
            {type === "playback" ? (
              <>
                <option value="played">Diputar</option>
                <option value="failed">Gagal</option>
              </>
            ) : (
              <>
                <option value="resolved">Selesai</option>
                <option value="unresolved">Belum selesai</option>
              </>
            )}
          </select>
        </label>
        <label>
          Dari
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Sampai
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Pencarian
          <input
            value={text}
            maxLength={100}
            onChange={(event) => {
              setText(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {!range.ok && <p role="alert">Rentang tanggal harus valid dan maksimal 30 hari.</p>}
      {history.isLoading && <p role="status">Memuat riwayat...</p>}
      {(history.isError || (history.data && !history.data.ok)) && (
        <div role="alert">
          <p>Riwayat tidak dapat dimuat.</p>
          <button type="button" onClick={() => history.refetch()}>
            Coba Lagi
          </button>
        </div>
      )}
      {history.data?.ok && !rows.length && <p>Belum ada riwayat.</p>}
      {!!rows.length && (
        <ul className="space-y-2">
          {rows.map((row: Record<string, unknown>) => (
            <li key={String(row.id)} className="brutal-border bg-card p-3">
              <strong>{String(row.label ?? row.report_code ?? row.audio_id ?? "Aktivitas")}</strong>
              <p>{String(row.status ?? row.stage ?? "")}</p>
              <time>{String(row.event_timestamp ?? row.occurred_at ?? "")}</time>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
          Halaman sebelumnya
        </button>
        <span>Halaman {page}</span>
        <button
          type="button"
          disabled={!history.data?.ok || history.data.nextPage === null}
          onClick={() => setPage((value) => value + 1)}
        >
          Halaman berikutnya
        </button>
      </div>
    </section>
  );
}
