import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, CircleAlert, Search, TriangleAlert } from "lucide-react";
import { listOperationalErrors, resolveOperationalError } from "@/lib/operational-errors.server";
import { normalizeHistoryRange } from "@/lib/owner-history-domain";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import {
  formatOwnerDate,
  TaEmpty,
  TaField,
  TaLoading,
  TaNotice,
  TaPage,
  TaPageHeader,
  TaPagination,
  TaCard,
  TaRetry,
  TaBadge,
  taControlClass,
  taPrimaryButtonClass,
} from "@/components/dashboard/ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      "owner-operational-errors",
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
        queryClient.invalidateQueries({ queryKey: ["owner-operational-errors"] }),
        queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] }),
      ]);
    },
    onError: () => setMutationError("Error gagal diselesaikan."),
  });
  const rows = errors.data?.ok ? (errors.data.errors as ErrorRow[]) : [];
  const unresolvedCount = rows.filter((row) => !row.resolved_at).length;
  const resetPage = () => setPage(1);

  return (
    <TaPage>
      <TaPageHeader
        eyebrow="Monitoring Insiden"
        title="Error Log"
        description="Tinjau error operasional, buka detail aman, lalu tandai insiden yang sudah ditangani."
      />

      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Ditampilkan" value={String(rows.length)} tone="neutral" />
        <Metric label="Belum selesai" value={String(unresolvedCount)} tone="danger" />
        <Metric label="Selesai" value={String(rows.length - unresolvedCount)} tone="success" />
      </section>

      <TaCard
        title="Filter error"
        description="Data awal menampilkan error operasional 7 hari terakhir."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <TaField label="Restoran">
            <select
              className={taControlClass}
              value={restaurantId}
              onChange={(event) => {
                setRestaurantId(event.target.value);
                resetPage();
              }}
            >
              <option value="">Semua restoran</option>
              {restaurants.data?.ok &&
                restaurants.data.restaurants.map(
                  (restaurant: { id: string; display_name: string }) => (
                    <option key={restaurant.id} value={restaurant.id}>
                      {restaurant.display_name}
                    </option>
                  ),
                )}
            </select>
          </TaField>
          <TaField label="Status">
            <select
              className={taControlClass}
              value={resolved}
              onChange={(event) => {
                setResolved(event.target.value);
                resetPage();
              }}
            >
              <option value="">Semua status</option>
              <option value="unresolved">Belum selesai</option>
              <option value="resolved">Selesai</option>
            </select>
          </TaField>
          <TaField label="Stage">
            <input
              className={taControlClass}
              value={stage}
              maxLength={60}
              placeholder="Contoh: playback"
              onChange={(event) => {
                setStage(event.target.value);
                resetPage();
              }}
            />
          </TaField>
          <TaField label="Report code">
            <input
              className={taControlClass}
              value={reportCode}
              maxLength={60}
              placeholder="Cari kode laporan"
              onChange={(event) => {
                setReportCode(event.target.value);
                resetPage();
              }}
            />
          </TaField>
          <TaField label="Dari tanggal">
            <input
              className={taControlClass}
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                resetPage();
              }}
            />
          </TaField>
          <TaField label="Sampai tanggal">
            <input
              className={taControlClass}
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                resetPage();
              }}
            />
          </TaField>
          <TaField label="Pencarian">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className={`${taControlClass} pl-10`}
                value={text}
                maxLength={100}
                placeholder="Cari detail error..."
                onChange={(event) => {
                  setText(event.target.value);
                  resetPage();
                }}
              />
            </div>
          </TaField>
        </div>
      </TaCard>

      {errors.isLoading && <TaLoading label="Memuat Error Log..." />}
      {(errors.isError || (errors.data && !errors.data.ok)) && (
        <TaCard>
          <TaNotice role="alert" tone="danger">
            Error Log tidak dapat dimuat.
          </TaNotice>
          <div className="mt-4">
            <TaRetry label="Coba Lagi" onClick={() => errors.refetch()} />
          </div>
        </TaCard>
      )}
      {errors.data?.ok && !rows.length && (
        <TaCard>
          <TaEmpty
            title="Tidak ada error"
            description="Tidak ditemukan error yang sesuai dengan filter saat ini."
          />
        </TaCard>
      )}
      {!!rows.length && (
        <TaCard
          title="Daftar insiden"
          description="Pilih baris untuk membuka detail dan tindakan penyelesaian."
          className="overflow-hidden"
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Waktu</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  onClick={() => {
                    setSelected(row);
                    setMutationError("");
                  }}
                >
                  <TableCell className="font-mono text-xs font-bold text-slate-900">
                    {row.report_code}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-slate-600">
                    {row.stage}
                    {row.detail ? ` · ${row.detail}` : ""}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-slate-600">
                    {formatOwnerDate(row.occurred_at)}
                  </TableCell>
                  <TableCell>
                    <TaBadge tone={row.resolved_at ? "success" : "danger"}>
                      {row.resolved_at ? "Selesai" : "Belum selesai"}
                    </TaBadge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TaCard>
      )}
      <TaPagination
        page={page}
        hasNext={!!errors.data?.ok && errors.data.nextPage !== null}
        onPrevious={() => setPage((value) => value - 1)}
        onNext={() => setPage((value) => value + 1)}
      />

      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setNote("");
            setMutationError("");
          }
        }}
      >
        <DialogContent className="max-h-[90svh] overflow-y-auto rounded-2xl border-slate-200 sm:max-w-2xl">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-3">
              <span
                className={`grid size-10 place-items-center rounded-xl ${selected?.resolved_at ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
              >
                <CircleAlert className="size-5" />
              </span>
              <TaBadge tone={selected?.resolved_at ? "success" : "danger"}>
                {selected?.resolved_at ? "Selesai" : "Belum selesai"}
              </TaBadge>
            </div>
            <DialogTitle className="text-xl font-black text-slate-950">
              {selected?.report_code}
            </DialogTitle>
            <DialogDescription>Detail aman error operasional.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Stage" value={selected.stage} />
                <Detail label="Waktu kejadian" value={formatOwnerDate(selected.occurred_at)} />
                <Detail label="Perangkat" value={selected.device_id || "—"} mono />
                <Detail label="Sesi crew" value={selected.crew_session_id || "—"} mono />
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Detail</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                  {selected.detail || "Tanpa detail."}
                </p>
              </div>
              {selected.resolved_at ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <p className="font-extrabold">
                    Diselesaikan {formatOwnerDate(selected.resolved_at)}
                  </p>
                  <p className="mt-1">Oleh: {selected.resolved_by || "—"}</p>
                  <p className="mt-1">Catatan: {selected.resolution_note || "Tanpa catatan."}</p>
                </div>
              ) : (
                <TaField
                  label="Catatan penyelesaian"
                  hint={`${note.length}/1000 karakter · opsional`}
                >
                  <textarea
                    className={`${taControlClass} min-h-28 resize-y`}
                    value={note}
                    maxLength={1000}
                    placeholder="Jelaskan tindakan yang sudah dilakukan..."
                    onChange={(event) => setNote(event.target.value)}
                  />
                </TaField>
              )}
              {mutationError && (
                <TaNotice role="alert" tone="danger">
                  {mutationError}
                </TaNotice>
              )}
            </div>
          )}
          <DialogFooter>
            {selected && !selected.resolved_at && (
              <button
                type="button"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate()}
                className={taPrimaryButtonClass}
              >
                <CheckCircle2 className="size-4" />{" "}
                {resolve.isPending ? "Menyimpan..." : "Tandai selesai"}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TaPage>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger" ? "text-red-700" : tone === "success" ? "text-emerald-700" : "text-slate-950";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={`mt-1 break-all text-sm font-bold text-slate-800 ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
