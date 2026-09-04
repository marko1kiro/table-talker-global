import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { listOwnerHistory } from "@/lib/owner-history.server";
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
} from "@/components/dashboard/ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const resetPage = () => setPage(1);

  return (
    <TaPage>
      <TaPageHeader
        eyebrow="Audit Aktivitas"
        title="Riwayat"
        description="Telusuri playback dan sinkronisasi. Default 7 hari terakhir, maksimal 30 hari."
      />
      <TaCard
        title="Filter riwayat"
        description="Persempit data berdasarkan restoran, aktivitas, status, atau tanggal."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <TaField label="Restoran">
            <select
              className={taControlClass}
              value={restaurantId}
              onChange={(e) => {
                setRestaurantId(e.target.value);
                resetPage();
              }}
            >
              <option value="">Semua restoran</option>
              {restaurants.data?.ok &&
                restaurants.data.restaurants.map((r: { id: string; display_name: string }) => (
                  <option key={r.id} value={r.id}>
                    {r.display_name}
                  </option>
                ))}
            </select>
          </TaField>
          <TaField label="Jenis aktivitas">
            <select
              className={taControlClass}
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setStatus("");
                resetPage();
              }}
            >
              <option value="playback">Playback</option>
              <option value="sync">Sinkronisasi</option>
            </select>
          </TaField>
          <TaField label="Status">
            <select
              className={taControlClass}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                resetPage();
              }}
            >
              <option value="">Semua status</option>
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
          </TaField>
          <TaField label="Dari tanggal">
            <input
              className={taControlClass}
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                resetPage();
              }}
            />
          </TaField>
          <TaField label="Sampai tanggal">
            <input
              className={taControlClass}
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
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
                placeholder="Cari label atau kode..."
                onChange={(e) => {
                  setText(e.target.value);
                  resetPage();
                }}
              />
            </div>
          </TaField>
        </div>
      </TaCard>

      {!range.ok && (
        <TaNotice role="alert" tone="danger">
          Rentang tanggal harus valid dan maksimal 30 hari.
        </TaNotice>
      )}
      {history.isLoading && <TaLoading label="Memuat riwayat..." />}
      {(history.isError || (history.data && !history.data.ok)) && (
        <TaCard>
          <TaNotice role="alert" tone="danger">
            Riwayat tidak dapat dimuat.
          </TaNotice>
          <div className="mt-4">
            <TaRetry onClick={() => history.refetch()} />
          </div>
        </TaCard>
      )}
      {history.data?.ok && !rows.length && (
        <TaCard>
          <TaEmpty
            title="Belum ada riwayat"
            description="Aktivitas yang sesuai dengan filter akan muncul di sini."
          />
        </TaCard>
      )}
      {!!rows.length && (
        <TaCard className="overflow-hidden" title={`${rows.length} aktivitas pada halaman ini`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Aktivitas</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row: Record<string, unknown>) => {
                const rowStatus = String(row.status ?? row.stage ?? "Aktivitas");
                return (
                  <TableRow key={String(row.id)}>
                    <TableCell className="whitespace-nowrap text-slate-600">
                      {formatOwnerDate(row.event_timestamp ?? row.occurred_at)}
                    </TableCell>
                    <TableCell className="max-w-md truncate font-semibold text-slate-900">
                      {String(row.label ?? row.report_code ?? row.audio_id ?? "Aktivitas")}
                    </TableCell>
                    <TableCell className="text-right">
                      <TaBadge
                        tone={
                          /fail|gagal|reject|error/i.test(rowStatus)
                            ? "danger"
                            : /play|deliver|selesai|resolved/i.test(rowStatus)
                              ? "success"
                              : "neutral"
                        }
                      >
                        {rowStatus}
                      </TaBadge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TaCard>
      )}
      <TaPagination
        page={page}
        hasNext={!!history.data?.ok && history.data.nextPage !== null}
        onPrevious={() => setPage((v) => v - 1)}
        onNext={() => setPage((v) => v + 1)}
        previousLabel="Halaman sebelumnya"
        nextLabel="Halaman berikutnya"
      />
    </TaPage>
  );
}
