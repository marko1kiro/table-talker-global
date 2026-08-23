import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { listOperationalErrors, resolveOperationalError } from "@/lib/operational-errors.server";
import { normalizeHistoryRange } from "@/lib/owner-history-domain";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/super-admin/error-log")({ component: ErrorLog });

type ErrorRow = {
  id: string;
  restaurant_id: string | null;
  stage: string;
  report_code: string;
  detail: string | null;
  device_id: string | null;
  crew_session_id: string | null;
  occurred_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
};

function ErrorLog() {
  const queryClient = useQueryClient();
  const now = useMemo(() => new Date(), []);
  const initial = normalizeHistoryRange({}, now);
  const [restaurantId, setRestaurantId] = useState("");
  const [stage, setStage] = useState("");
  const [reportCode, setReportCode] = useState("");
  const [resolved, setResolved] = useState("");
  const [text, setText] = useState("");
  const [from, setFrom] = useState(initial.ok ? initial.from.slice(0, 10) : "");
  const [to, setTo] = useState(initial.ok ? initial.to.slice(0, 10) : "");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<ErrorRow | null>(null);
  const [note, setNote] = useState("");
  const [mutationError, setMutationError] = useState("");
  const restaurants = useQuery({ queryKey: ["owner-restaurants"], queryFn: listOwnerRestaurants });
  const errors = useQuery({
    queryKey: [
      "operational-errors",
      restaurantId,
      stage,
      reportCode,
      resolved,
      text,
      from,
      to,
      page,
    ],
    queryFn: () =>
      listOperationalErrors({
        data: {
          restaurantId: restaurantId || undefined,
          stage: stage || undefined,
          reportCode: reportCode || undefined,
          resolved: resolved === "resolved" ? true : resolved === "unresolved" ? false : undefined,
          text: text || undefined,
          from: `${from}T00:00:00.000Z`,
          to: `${to}T23:59:59.999Z`,
          page,
        },
      }),
  });
  const resolve = useMutation({
    mutationFn: () =>
      resolveOperationalError({ data: { errorId: selected!.id, note: note || undefined } }),
    onSuccess: async (result) => {
      if (!result.ok) return setMutationError(result.message);
      setSelected(null);
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["operational-errors"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] }),
      ]);
    },
    onError: () => setMutationError("Error gagal diselesaikan."),
  });
  const rows = errors.data?.ok ? (errors.data.errors as ErrorRow[]) : [];

  return (
    <section className="space-y-4">
      <header>
        <h1 className="font-display text-2xl uppercase">Error Log</h1>
        <p>Error operasional 7 hari terakhir.</p>
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
          Stage
          <input
            value={stage}
            maxLength={60}
            onChange={(event) => {
              setStage(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Report code
          <input
            value={reportCode}
            maxLength={60}
            onChange={(event) => {
              setReportCode(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Status
          <select
            value={resolved}
            onChange={(event) => {
              setResolved(event.target.value);
              setPage(1);
            }}
          >
            <option value="">Semua</option>
            <option value="unresolved">Belum selesai</option>
            <option value="resolved">Selesai</option>
          </select>
        </label>
        <label>
          Dari
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          Sampai
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <label>
          Pencarian
          <input value={text} maxLength={100} onChange={(event) => setText(event.target.value)} />
        </label>
      </div>
      {errors.isLoading && <p role="status">Memuat Error Log...</p>}
      {(errors.isError || (errors.data && !errors.data.ok)) && (
        <div role="alert">
          <p>Error Log tidak dapat dimuat.</p>
          <button type="button" onClick={() => errors.refetch()}>
            Coba Lagi
          </button>
        </div>
      )}
      {errors.data?.ok && !rows.length && <p>Belum ada error.</p>}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="brutal-border bg-card p-3">
            <button
              type="button"
              onClick={() => {
                setSelected(row);
                setMutationError("");
              }}
            >
              {row.report_code}
            </button>
            <p>
              {row.stage} · {row.resolved_at ? "Selesai" : "Belum selesai"}
            </p>
            <time>{row.occurred_at}</time>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>
          Halaman sebelumnya
        </button>
        <span>Halaman {page}</span>
        <button
          type="button"
          disabled={!errors.data?.ok || errors.data.nextPage === null}
          onClick={() => setPage((value) => value + 1)}
        >
          Halaman berikutnya
        </button>
      </div>
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.report_code}</DialogTitle>
            <DialogDescription>Detail aman error operasional.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-2">
              <p>Stage: {selected.stage}</p>
              <p>{selected.detail || "Tanpa detail."}</p>
              <p>Perangkat: {selected.device_id || "-"}</p>
              <p>Sesi: {selected.crew_session_id || "-"}</p>
              <p>Diselesaikan: {selected.resolved_at || "Belum"}</p>
              <p>Oleh: {selected.resolved_by || "-"}</p>
              <p>Catatan: {selected.resolution_note || "-"}</p>
              {!selected.resolved_at && (
                <label>
                  Catatan penyelesaian
                  <textarea
                    value={note}
                    maxLength={1000}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              )}
              {mutationError && <p role="alert">{mutationError}</p>}
            </div>
          )}
          <DialogFooter>
            {selected && !selected.resolved_at && (
              <button type="button" disabled={resolve.isPending} onClick={() => resolve.mutate()}>
                {resolve.isPending ? "Menyimpan..." : "Tandai selesai"}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
