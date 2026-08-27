import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { HistoryIcon, Search } from "lucide-react";
import { listOwnerHistory } from "@/lib/owner-history.server";
import { normalizeHistoryRange } from "@/lib/owner-history-domain";
import { listOwnerRestaurants } from "@/lib/owner-restaurants.server";
import {
  formatOwnerDate,
  OwnerEmpty,
  OwnerField,
  OwnerLoading,
  OwnerNotice,
  OwnerPage,
  OwnerPageHeader,
  OwnerPagination,
  OwnerPanel,
  OwnerRetry,
  StatusBadge,
  ownerControlClass,
} from "@/components/OwnerUi";

export const Route = createFileRoute("/super-admin/history")({ component: History });
const dateInput = (date: Date) => date.toISOString().slice(0, 10);

function History() {
  const now = useMemo(() => new Date(), []);
  const initial = normalizeHistoryRange({}, now);
  const [restaurantId, setRestaurantId] = useState("");
  const [type, setType] = useState<"playback" | "sync" | "broadcast">("playback");
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
    <OwnerPage>
      <OwnerPageHeader
        eyebrow="Audit Aktivitas"
        title="Riwayat"
        description="Telusuri playback, sinkronisasi, dan broadcast. Default 7 hari terakhir, maksimal 30 hari."
      />
      <OwnerPanel
        title="Filter riwayat"
        description="Persempit data berdasarkan restoran, aktivitas, status, atau tanggal."
      >
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <OwnerField label="Restoran">
            <select
              className={ownerControlClass}
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
          </OwnerField>
          <OwnerField label="Jenis aktivitas">
            <select
              className={ownerControlClass}
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setStatus("");
                resetPage();
              }}
            >
              <option value="playback">Playback</option>
              <option value="sync">Sinkronisasi</option>
              <option value="broadcast">Broadcast</option>
            </select>
          </OwnerField>
          <OwnerField label="Status">
            <select
              className={ownerControlClass}
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
              ) : type === "broadcast" ? (
                <>
                  <option value="delivered">Terkirim</option>
                  <option value="failed">Gagal</option>
                  <option value="rejected">Ditolak</option>
                  <option value="expired">Kedaluwarsa</option>
                </>
              ) : (
                <>
                  <option value="resolved">Selesai</option>
                  <option value="unresolved">Belum selesai</option>
                </>
              )}
            </select>
          </OwnerField>
          <OwnerField label="Dari tanggal">
            <input
              className={ownerControlClass}
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                resetPage();
              }}
            />
          </OwnerField>
          <OwnerField label="Sampai tanggal">
            <input
              className={ownerControlClass}
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                resetPage();
              }}
            />
          </OwnerField>
          <OwnerField label="Pencarian">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className={`${ownerControlClass} pl-10`}
                value={text}
                maxLength={100}
                placeholder="Cari label atau kode..."
                onChange={(e) => {
                  setText(e.target.value);
                  resetPage();
                }}
              />
            </div>
          </OwnerField>
        </div>
      </OwnerPanel>

      {!range.ok && (
        <OwnerNotice role="alert" tone="danger">
          Rentang tanggal harus valid dan maksimal 30 hari.
        </OwnerNotice>
      )}
      {history.isLoading && <OwnerLoading label="Memuat riwayat..." />}
      {(history.isError || (history.data && !history.data.ok)) && (
        <OwnerPanel>
          <OwnerNotice role="alert" tone="danger">
            Riwayat tidak dapat dimuat.
          </OwnerNotice>
          <div className="mt-4">
            <OwnerRetry onClick={() => history.refetch()} />
          </div>
        </OwnerPanel>
      )}
      {history.data?.ok && !rows.length && (
        <OwnerPanel>
          <OwnerEmpty
            title="Belum ada riwayat"
            description="Aktivitas yang sesuai dengan filter akan muncul di sini."
          />
        </OwnerPanel>
      )}
      {!!rows.length && (
        <OwnerPanel className="overflow-hidden" title={`${rows.length} aktivitas pada halaman ini`}>
          <div className="divide-y divide-slate-100">
            {rows.map((row: Record<string, unknown>) => {
              const rowStatus = String(row.status ?? row.stage ?? "Aktivitas");
              return (
                <article
                  key={String(row.id)}
                  className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600">
                    <HistoryIcon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-extrabold text-slate-900">
                      {String(row.label ?? row.report_code ?? row.audio_id ?? "Aktivitas")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatOwnerDate(row.event_timestamp ?? row.occurred_at)}
                    </p>
                  </div>
                  <StatusBadge
                    tone={
                      /fail|gagal|reject|error/i.test(rowStatus)
                        ? "danger"
                        : /play|deliver|selesai|resolved/i.test(rowStatus)
                          ? "success"
                          : "neutral"
                    }
                  >
                    {rowStatus}
                  </StatusBadge>
                </article>
              );
            })}
          </div>
        </OwnerPanel>
      )}
      <OwnerPagination
        page={page}
        hasNext={!!history.data?.ok && history.data.nextPage !== null}
        onPrevious={() => setPage((v) => v - 1)}
        onNext={() => setPage((v) => v + 1)}
        previousLabel="Halaman sebelumnya"
        nextLabel="Halaman berikutnya"
      />
    </OwnerPage>
  );
}
